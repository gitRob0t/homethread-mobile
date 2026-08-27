import { supabase } from '../lib/supabase';
import { clearLocationTrackingForSignOut } from './familyLocation';
import * as WebBrowser from 'expo-web-browser';

export const authCallbackUrl = 'homethread://auth/callback';

WebBrowser.maybeCompleteAuthSession();

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: authCallbackUrl,
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authCallbackUrl,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in could not be started.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, authCallbackUrl);
  if (result.type === 'success' && result.url) await completeAuthRedirect(result.url);
  else if (result.type === 'dismiss' || result.type === 'cancel') throw new Error('Google sign-in was canceled.');
  else throw new Error('Google sign-in returned without an authorization response.');
}

export async function signOut() {
  await clearLocationTrackingForSignOut().catch(() => undefined);
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: authCallbackUrl },
  );
  if (error) throw error;
}

export async function completeAuthRedirect(url: string) {
  if (!url.startsWith(authCallbackUrl)) return;

  const queryUrl = url.replace('#', '?');
  const parsed = new URL(queryUrl);
  const code = parsed.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const accessToken = parsed.searchParams.get('access_token');
  const refreshToken = parsed.searchParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }
}
