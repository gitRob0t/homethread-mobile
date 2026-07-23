import type { FunctionInvokeOptions } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

type EdgeInvokeOptions = Pick<FunctionInvokeOptions, 'body' | 'headers'>;

type EdgeErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

export class CohoEdgeFunctionError extends Error {
  readonly functionName: string;
  readonly status: number | null;
  readonly code: string | null;

  constructor(input: {
    functionName: string;
    message: string;
    status?: number | null;
    code?: string | null;
  }) {
    super(input.message);
    this.name = 'CohoEdgeFunctionError';
    this.functionName = input.functionName;
    this.status = input.status ?? null;
    this.code = input.code ?? null;
  }
}

export async function invokeEdgeFunction<T>(
  functionName: string,
  options: EdgeInvokeOptions = {},
): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  let accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new CohoEdgeFunctionError({
      functionName,
      status: 401,
      code: 'session_missing',
      message: 'Your Coho session expired. Sign in again and retry.',
    });
  }

  let result = await invoke<T>(functionName, options, accessToken);
  if (result.error && await responseStatus(result.error) === 401) {
    const refreshed = await supabase.auth.refreshSession();
    accessToken = refreshed.data.session?.access_token;
    if (!refreshed.error && accessToken) {
      result = await invoke<T>(functionName, options, accessToken);
    }
  }

  if (result.error) throw await normalizeEdgeError(functionName, result.error);
  return result.data as T;
}

async function invoke<T>(
  functionName: string,
  options: EdgeInvokeOptions,
  accessToken: string,
) {
  return supabase.functions.invoke<T>(functionName, {
    body: options.body,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function responseStatus(error: unknown) {
  const response = responseFromError(error);
  return response?.status ?? null;
}

async function normalizeEdgeError(functionName: string, error: unknown) {
  const response = responseFromError(error);
  const status = response?.status ?? null;
  const payload = await responsePayload(response);
  const code = stringValue(payload?.code);
  const serverMessage = firstString(payload?.error, payload?.message);
  const normalized = (serverMessage || '').toLowerCase();

  let message = serverMessage;
  if (
    status === 401
    || normalized.includes('invalid jwt')
    || normalized.includes('invalid session')
    || normalized.includes('authorization header')
  ) {
    message = 'Your Coho session expired. Sign in again and retry.';
  } else if (status === 404 && code === 'NOT_FOUND') {
    message = `${functionLabel(functionName)} has not been deployed yet. Finish the Coho backend deployment and retry.`;
  } else if (
    normalized.includes('gen_random_bytes')
    || normalized.includes('function digest')
  ) {
    message = 'Coho’s secure invitation setup is out of date. Apply the latest database update and retry.';
  } else if (
    normalized.includes('relation')
    && normalized.includes('does not exist')
  ) {
    message = 'Coho’s database update is incomplete. Apply the latest backend migrations and retry.';
  } else if (!message && status === 503) {
    message = `${functionLabel(functionName)} is not configured in production yet.`;
  } else if (!message) {
    message = `${functionLabel(functionName)} could not complete the request. Please retry.`;
  }

  return new CohoEdgeFunctionError({
    functionName,
    status,
    code,
    message,
  });
}

function responseFromError(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: unknown }).context;
  if (
    context
    && typeof context === 'object'
    && 'status' in context
  ) {
    return context as Response;
  }
  return null;
}

async function responsePayload(response: Response | null): Promise<EdgeErrorPayload | null> {
  if (!response) return null;
  try {
    return await response.clone().json() as EdgeErrorPayload;
  } catch {
    try {
      const text = (await response.clone().text()).trim();
      return text ? { message: text.slice(0, 500) } : null;
    } catch {
      return null;
    }
  }
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

function functionLabel(functionName: string) {
  const labels: Record<string, string> = {
    'calendar-oauth': 'Calendar connection',
    'calendar-sync': 'Calendar sync',
    'coh-assistant': 'Coh',
    'coh-extract': 'Family Inbox review',
    'instacart-shopping-list': 'Shopping-list handoff',
    'privacy-data': 'Privacy service',
    'run-automations': 'Automation worker',
    'send-household-invite': 'Family invitation',
  };
  return labels[functionName] || 'Coho service';
}
