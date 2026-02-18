import express from 'express';
import auth from '../middleware/authMiddleware.js';
import Chat from '../models/Chat.js';
import ConversationNode from '../models/ConversationNode.js';
import User from '../models/User.js';
import openai from '../config/openai.js';
import { emitAdminEvent } from '../realtime.js';
import ChatEvent from '../models/ChatEvent.js';
import UsageEvent from '../models/UsageEvent.js';
import { getClientIpFromReq } from '../utils/clientIp.js';

const router = express.Router();

async function createStreamWithFallback(messages) {
  const primaryModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const fallbackModel = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
  const candidates = Array.from(new Set([primaryModel, fallbackModel].filter(Boolean)));
  let lastErr = null;

  for (const model of candidates) {
    try {
      const stream = await openai.chat.completions.create({
        model,
        stream: true,
        messages,
      });
      return { stream, model };
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status || 0);
      const code = String(err?.code || err?.error?.code || '').toLowerCase();
      const msg = String(err?.message || '').toLowerCase();
      const isModelIssue =
        status === 404 ||
        code === 'model_not_found' ||
        msg.includes('model') ||
        msg.includes('not found') ||
        msg.includes('does not exist') ||
        msg.includes('do not have access');
      if (!isModelIssue) throw err;
    }
  }

  throw lastErr || new Error('No OpenAI model available');
}

router.post('/chat/stream', auth, async (req, res) => {
  const { message, chatId, messageId } = req.body;
  const user = await User.findById(req.user.id);
  // token limit enforcement removed

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

   let chat;
   if (chatId) {
     chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
     if (!chat) return res.status(404).end();
    } else {
      chat = await Chat.create({
        userId: user._id,
        title: message.slice(0, 40),
        messages: []
      });
       ChatEvent.create({
         userId: user._id,
         chatId: chat._id,
         type: 'CHAT_CREATED',
         title: chat.title,
         ip: getClientIpFromReq(req),
       }).catch(() => {});
       emitAdminEvent({
         type: 'CHAT_CREATED',
         userId: String(user._id),
         username: req.user?.username || user.username,
         ip: getClientIpFromReq(req),
         chatId: String(chat._id),
         title: chat.title
       });
   }

  let messageIndex;

  if (messageId) {
    // editing existing message: create a new version and regenerate from there
    messageIndex = chat.messages.findIndex(m => m._id.toString() === messageId);
    if (messageIndex === -1) {
      return res.status(404).end();
    }

    const msg = chat.messages[messageIndex];
    if (msg && (!msg.versions || !Array.isArray(msg.versions) || msg.versions.length === 0)) {
      // upgrade legacy message to versioned format
      msg.versions = [{ version: 1, content: msg.content || '', assistant: '' }];
      msg.activeVersion = 1;
      delete msg.content;
    }

    const nextVersion = (msg.versions?.length || 0) + 1;
    msg.versions.push({ version: nextVersion, content: message, assistant: '' });
    msg.activeVersion = nextVersion;

    // Keep chat title in sync with the first user message.
    if (messageIndex === 0 && typeof message === 'string' && message.trim()) {
      chat.title = message.slice(0, 40);
    }

    // ChatGPT-like behavior: when editing an earlier message, drop messages after it.
    if (chat.messages.length > messageIndex + 1) {
      chat.messages.splice(messageIndex + 1);
    }
  } else {
    // create new user message with version 1
    const userMessage = {
      role: 'user',
      activeVersion: 1,
      versions: [{ version: 1, content: message, assistant: '' }]
    };

    chat.messages.push(userMessage);
    messageIndex = chat.messages.length - 1;
  }

  let fullReply = '';

  // Estimate credits immediately so admin charts can update both lines without waiting
  // for the assistant response.
  const tokensUsedEst = Math.max(1, Math.ceil(String(message || '').length / 4));

  // Emit a realtime request event immediately (no DB wait) so admin charts move fast.
  emitAdminEvent({
    type: 'USAGE',
    stage: 'request',
    userId: String(req.user.id),
    chatId: chatId ? String(chatId) : undefined,
    tokensUsed: tokensUsedEst
  });

  // Persist the request immediately; fill/adjust tokensUsed after completion.
  const usageDocPromise = UsageEvent.create({ userId: req.user.id, tokensUsed: tokensUsedEst }).catch(() => null);

  try {
    const systemPrompt = {
      role: 'system',
      content:
        "You are a helpful assistant. Format responses using GitHub-flavored Markdown. Use clear structure (headings, lists), bold key terms, and fenced code blocks with language tags when relevant. Do not output HTML.",
    };

    const history = chat.messages.flatMap(m => {
      const v = m.versions[m.activeVersion - 1];
      return [
        { role: 'user', content: v.content },
        ...(v.assistant ? [{ role: 'assistant', content: v.assistant }] : [])
      ];
    });

    const openAIMessages = [systemPrompt, ...history];

    const { stream, model } = await createStreamWithFallback(openAIMessages);
    console.log(`[chat] using model: ${model}`);

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        fullReply += token;
        // Send JSON so newlines/Unicode are preserved safely over SSE.
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

      // save assistant reply into the active version
      const msg = chat.messages[messageIndex];
      const vIndex = msg.activeVersion - 1;
       msg.versions[vIndex].assistant = fullReply;
       await chat.save();

       // record token usage (chat requests only)
       const tokensUsed = Math.ceil(fullReply.length / 4);
       const usageDoc = await usageDocPromise;
       const delta = (usageDoc ? tokensUsed - (usageDoc.tokensUsed || 0) : 0);
        if (usageDoc?._id) {
          await UsageEvent.updateOne({ _id: usageDoc._id }, { $set: { tokensUsed } }).catch(() => {});
        } else {
          await UsageEvent.create({ userId: req.user.id, tokensUsed }).catch(() => {});
        }

        emitAdminEvent({
          type: 'USAGE',
          stage: 'complete',
          userId: String(req.user.id),
          tokensUsed,
          tokensDelta: delta,
          chatId: String(chat._id)
        });

      res.write(`event: done\ndata: ${JSON.stringify({ chatId: String(chat._id) })}\n\n`);
      res.end();
  } catch (err) {
    console.error('[chat] stream failed:', err?.status || '', err?.code || '', err?.message || err);
    // If the call failed, keep the request count but leave credits at 0.
    res.write(
      `event: error\ndata: ${JSON.stringify({
        error: 'failed',
        detail: String(err?.message || 'Chat request failed'),
      })}\n\n`
    );
    res.end();
  }
});

router.get('/chats', auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.user.id })
    .select('_id title createdAt')
    .sort({ createdAt: -1 });
  res.json(chats);
});

router.patch('/chat/:id/title', auth, async (req, res) => {
  const { title } = req.body;
  await Chat.updateOne(
    { _id: req.params.id, userId: req.user.id },
    { $set: { title } }
  );
  res.sendStatus(204);
});

router.get('/chat/:id', auth, async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
  if (!chat) return res.sendStatus(404);

  // ✅ STEP 3: load messages from active ConversationNode if present
  if (chat.activeNodeId) {
    const node = await ConversationNode.findById(chat.activeNodeId);
    if (node) {
      return res.json({
        _id: chat._id,
        title: chat.title,
        messages: node.messages,
        activeNodeId: chat.activeNodeId
      });
    }
  }

  // fallback to legacy chat messages
  res.json(chat);
});

router.patch('/chat/:chatId/message/:messageId/version', auth, async (req, res) => {
  const { content } = req.body;
  const { chatId, messageId } = req.params;

  const chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
  if (!chat) return res.sendStatus(404);

  let message = chat.messages.id(messageId);

  // ✅ handle legacy message (no versions yet)
  if (message && !message.versions) {
    message.versions = [{ version: 1, content: message.content || '', assistant: '' }];
    message.activeVersion = 1;
    delete message.content;
  }

  if (!message) return res.sendStatus(404);

  const nextVersion = message.versions.length + 1;
  message.versions.push({ version: nextVersion, content, assistant: '' });
  message.activeVersion = nextVersion;

  await chat.save();
  res.json({ version: nextVersion });
});

router.patch('/chat/:chatId/message/:messageId/active-version', auth, async (req, res) => {
  const { chatId, messageId } = req.params;
  const { version } = req.body;

  const chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
  if (!chat) return res.sendStatus(404);

  const message = chat.messages.id(messageId);
  if (!message) return res.sendStatus(404);

  if (version < 1 || version > message.versions.length) {
    return res.status(400).json({ error: 'Invalid version' });
  }

  message.activeVersion = version;
  await chat.save();

  res.json({ activeVersion: version });
});

// ✅ STEP 4: switch active conversation node (branch)
router.patch('/chat/:id/active-node', auth, async (req, res) => {
  const { nodeId } = req.body;

  const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
  if (!chat) return res.sendStatus(404);

  // ensure node belongs to this chat
  const node = await ConversationNode.findOne({ _id: nodeId, chatId: chat._id });
  if (!node) return res.status(400).json({ error: 'Invalid node' });

  chat.activeNodeId = node._id;
  await chat.save();

  res.json({ activeNodeId: node._id });
});

router.delete('/chat/:id', auth, async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id }).select('_id title');
  if (chat) {
    ChatEvent.create({
      userId: req.user.id,
      chatId: chat._id,
      type: 'CHAT_DELETED',
      title: chat.title,
      ip: getClientIpFromReq(req),
    }).catch(() => {});
    emitAdminEvent({
      type: 'CHAT_DELETED',
      userId: String(req.user.id),
      username: req.user?.username,
      ip: getClientIpFromReq(req),
      chatId: String(chat._id),
      title: chat.title
    });
  }
  await Chat.deleteOne({ _id: req.params.id, userId: req.user.id });
  res.sendStatus(204);
});

export default router;
