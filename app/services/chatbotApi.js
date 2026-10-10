import {supabase, getSessionUser} from './supabaseClient';

const FUNCTION_NAME =
  process.env.EXPO_PUBLIC_AI_ASSISTANT_FUNCTION ||
  process.env.REACT_APP_AI_ASSISTANT_FUNCTION ||
  'informational-ai-assistant';

const TOKEN_EXPIRY_BUFFER_MS = 120000;
const MAX_MESSAGE_LENGTH = 2000;
const CHATBOT_DISCLAIMER =
  'This chatbot provides general information only and is not legal advice.';

const normalizeText = value => String(value || '').trim();

const sanitizeHistory = history => {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-12)
    .map(entry => ({
      role: entry?.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeText(entry?.content || ''),
    }))
    .filter(entry => Boolean(entry.content));
};

const normalizeConversationEntry = entry => {
  if (!entry || typeof entry !== 'object') return null;

  const role = normalizeText(entry.role || entry.from || entry.sender).toLowerCase();
  const content = normalizeText(entry.content || entry.text || entry.message);

  if (!content) return null;

  return {
    role: role === 'assistant' || role === 'ai' ? 'assistant' : 'user',
    content,
  };
};

const conversationToAssistantHistory = conversation =>
  (Array.isArray(conversation) ? conversation : [])
    .map(normalizeConversationEntry)
    .filter(Boolean);

const getSessionFromAuth = async () => {
  const {
    data: {session},
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(
      sessionError.message || 'Unable to validate your session. Please sign in again.',
    );
  }

  return session;
};

const isTokenExpiring = (session, bufferMs = TOKEN_EXPIRY_BUFFER_MS) => {
  const accessToken = normalizeText(session?.access_token);
  if (!accessToken) return true;

  const expiresAtMs = Number(session?.expires_at || 0) * 1000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return false;

  return expiresAtMs - Date.now() <= bufferMs;
};

const refreshSessionOrNull = async () => {
  const refresh = await supabase.auth.refreshSession();
  if (refresh?.error || !refresh?.data?.session?.access_token) {
    return null;
  }

  return refresh.data.session;
};

const getValidSession = async ({forceRefresh = false} = {}) => {
  const session = await getSessionFromAuth();
  const shouldRefresh = forceRefresh || isTokenExpiring(session);

  if (shouldRefresh) {
    const refreshedSession = await refreshSessionOrNull();
    if (!refreshedSession) {
      throw new Error('Your session has expired. Please sign in again.');
    }
    return refreshedSession;
  }

  return session;
};

const invokeAssistant = ({accessToken, cleanMessage, history}) =>
  supabase.functions.invoke(FUNCTION_NAME, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: {
      message: cleanMessage,
      history: sanitizeHistory(history),
    },
  });

const readFunctionContextMessage = async context => {
  if (!context) return '';

  const parseText = responseText => {
    const raw = normalizeText(responseText);
    if (!raw) return '';

    try {
      const parsed = JSON.parse(raw);
      return normalizeText(parsed?.error || parsed?.message || raw);
    } catch {
      return raw;
    }
  };

  try {
    if (typeof context.clone === 'function') {
      const cloned = context.clone();
      const clonedText = await cloned.text();
      const parsed = parseText(clonedText);
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to direct context body read.
  }

  try {
    const directText = await context.text();
    return parseText(directText);
  } catch {
    return '';
  }
};

const isLikelyAuthFailure = ({statusCode, message}) => {
  const normalized = normalizeText(message).toLowerCase();
  const hasUnsupportedTokenAlgorithm =
    normalized.includes('unsupported jwt algorithm') ||
    normalized.includes('unsupported token algorithm');

  if (hasUnsupportedTokenAlgorithm) return false;

  if (statusCode === 401 || statusCode === 403) return true;

  return (
    normalized.includes('invalid jwt') ||
    normalized.includes('jwt expired') ||
    normalized.includes('missing authorization') ||
    normalized.includes('unauthorized')
  );
};

const mapAssistantProviderFailureMessage = message => {
  const normalized = normalizeText(message).toLowerCase();
  if (!normalized) return '';

  const isQuotaError =
    normalized.includes('quota exceeded') ||
    normalized.includes('rate limit') ||
    normalized.includes('limit: 0') ||
    normalized.includes('exceeded your current quota');

  if (isQuotaError) {
    return (
      'AI assistant is temporarily unavailable due to provider quota limits. Please try again in a minute.'
    );
  }

  const isHighDemandError =
    normalized.includes('high demand') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('please try again later');

  if (isHighDemandError) {
    return 'AI assistant is currently experiencing high demand. Please try again shortly.';
  }

  return '';
};

const extractFunctionError = async error => {
  let detailedMessage =
    normalizeText(error?.details) ||
    normalizeText(error?.error?.message) ||
    normalizeText(error?.message) ||
    'Unable to contact the AI assistant.';
  const statusCode = Number(error?.context?.status || error?.status || 0);

  try {
    const contextMessage = await readFunctionContextMessage(error?.context);
    if (contextMessage) {
      detailedMessage = contextMessage;
    }
  } catch {
    // Keep fallback message when response payload cannot be parsed.
  }

  if (Number.isFinite(statusCode) && statusCode > 0) {
    detailedMessage = `Assistant request failed (${statusCode}): ${detailedMessage}`;
  }

  const providerFriendlyMessage = mapAssistantProviderFailureMessage(detailedMessage);
  if (providerFriendlyMessage) {
    detailedMessage = providerFriendlyMessage;
  }

  return {
    statusCode,
    detailedMessage,
  };
};

export const initialChatbotMessages = [
  {
    from: 'ai',
    text: `Hello. I am your LegalLink assistant. ${CHATBOT_DISCLAIMER}`,
    actions: [
      {label: 'Book consultation', page: 'book-appointment'},
      {label: 'Notarial request', page: 'notarial-request'},
    ],
  },
];

export function isChatbotApiConfigured() {
  return Boolean(supabase?.functions?.invoke);
}

export async function fetchChatbotHealth() {
  let session = null;
  try {
    session = await getValidSession();
  } catch {
    session = null;
  }
  return {
    status: session?.access_token ? 'ok' : 'sign-in-required',
    transport: 'supabase-functions',
    function: FUNCTION_NAME,
  };
}

export async function requestInformationalAssistant({message, history = []}) {
  const cleanMessage = normalizeText(message).slice(0, MAX_MESSAGE_LENGTH);
  if (!cleanMessage) {
    throw new Error('Message cannot be empty.');
  }

  const session = await getValidSession();

  let {data, error} = await invokeAssistant({
    accessToken: session.access_token,
    cleanMessage,
    history,
  });

  if (error) {
    const extracted = await extractFunctionError(error);
    const shouldRetryAuth = isLikelyAuthFailure({
      statusCode: extracted.statusCode,
      message: extracted.detailedMessage,
    });

    if (shouldRetryAuth) {
      try {
        const refreshedSession = await getValidSession({forceRefresh: true});
        const retryResult = await invokeAssistant({
          accessToken: refreshedSession.access_token,
          cleanMessage,
          history,
        });

        data = retryResult.data;
        error = retryResult.error;
      } catch {
        throw new Error('Your session has expired. Please sign in again before using the AI assistant.');
      }
    }

    if (error) {
      const retryExtracted = await extractFunctionError(error);

      if (retryExtracted.statusCode >= 500 && Array.isArray(history) && history.length > 0) {
        const fallbackResult = await invokeAssistant({
          accessToken: session.access_token,
          cleanMessage,
          history: [],
        });

        if (!fallbackResult.error && fallbackResult.data?.reply) {
          return {
            kind: fallbackResult.data.kind || 'answer',
            reply: normalizeText(fallbackResult.data.reply),
          };
        }

        if (fallbackResult.error) {
          const fallbackExtracted = await extractFunctionError(fallbackResult.error);
          throw new Error(fallbackExtracted.detailedMessage);
        }
      }

      throw new Error(retryExtracted.detailedMessage);
    }
  }

  if (!data?.reply) {
    throw new Error('AI assistant returned an empty response.');
  }

  return {
    kind: data.kind || 'answer',
    reply: normalizeText(data.reply),
  };
}

const resolveUserId = async profile => {
  const candidate = normalizeText(profile?.id || profile?.user_id);
  if (candidate) return candidate;

  try {
    const user = await getSessionUser();
    return normalizeText(user?.id);
  } catch {
    return '';
  }
};

const logConversation = async ({userId, role, message, reply, intent}) => {
  if (!userId) return;

  try {
    await supabase.from('chatbot_logs').insert({
      user_id: userId,
      role: role || 'Client',
      message,
      response: reply,
      intent,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    const details = normalizeText(error?.message || '').toLowerCase();
    if (details.includes('does not exist') || details.includes('chatbot_logs')) {
      return;
    }
    console.warn('[chatbot] log insert failed', error);
  }
};

export async function sendChatbotMessage({message, profile, conversation = []}) {
  let result;

  try {
    const assistantResult = await requestInformationalAssistant({
      message,
      history: conversationToAssistantHistory(conversation),
    });
    result = {
      intent: String(assistantResult.kind || 'informational'),
      reply: assistantResult.reply,
      actions: [],
    };
  } catch (error) {
    console.warn('[chatbot] informational assistant failed', error);
    const detail = error instanceof Error ? error.message : 'Unable to reach the assistant.';
    result = {
      intent: 'error',
      reply: detail,
      actions: [{label: 'Book consultation', page: 'book-appointment'}],
    };
  }

  const userId = await resolveUserId(profile);

  await logConversation({
    userId,
    role: profile?.role || 'Client',
    message,
    reply: result.reply,
    intent: result.intent,
  });

  return result;
}