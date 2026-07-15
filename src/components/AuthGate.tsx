import type { Session } from '@supabase/supabase-js';
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { supabase } from '../lib/supabase';
import { resetPassword, signIn, signOut, signUp } from '../services/auth';
import { createHousehold, listHouseholds } from '../services/households';

type Props = { children: ReactNode };

export default function AuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasHousehold, setHasHousehold] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setHasHousehold(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listHouseholds()
      .then((memberships) => setHasHousehold(memberships.length > 0))
      .finally(() => setLoading(false));
  }, [session]);

  if (loading) return <LoadingScreen />;
  if (!session) return <AuthScreen />;
  if (!hasHousehold) {
    return <HouseholdSetup onCreated={() => setHasHousehold(true)} />;
  }
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <BrandMark />
        <ActivityIndicator color="#2257F4" style={{ marginTop: 24 }} />
      </View>
    </SafeAreaView>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    if (!email.trim() || password.length < 8 || (mode === 'signup' && !name.trim())) {
      setMessage('Enter your details and use a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signup') {
        const result = await signUp(email, password, name);
        if (!result.session) setMessage('Check your email to confirm your HomeThread account.');
      } else {
        await signIn(email, password);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to continue.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email.trim()) {
      setMessage('Enter your email first, then tap Forgot password.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email);
      setMessage('Password reset instructions are on the way.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send reset email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
        <View style={styles.authCard}>
          <BrandMark />
          <Text style={styles.title}>{mode === 'signin' ? 'Welcome home' : 'Start your family thread'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Sign in to see everything your family shares.'
              : 'One calm place for schedules, chores, notes, and messages.'}
          </Text>

          {mode === 'signup' && (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#8790A3"
              autoCapitalize="words"
              style={styles.input}
            />
          )}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor="#8790A3"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#8790A3"
            secureTextEntry
            style={styles.input}
            onSubmitEditing={submit}
          />

          {!!message && <Text style={styles.message}>{message}</Text>}
          <Pressable disabled={busy} onPress={submit} style={[styles.primaryButton, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>}
          </Pressable>

          {mode === 'signin' && <Pressable onPress={forgotPassword}><Text style={styles.textButton}>Forgot password?</Text></Pressable>}
          <Pressable onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>
            <Text style={styles.switchText}>{mode === 'signin' ? 'New to HomeThread? Create an account' : 'Already have an account? Sign in'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HouseholdSetup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    if (!name.trim()) return setMessage('Give your household a name.');
    setBusy(true);
    try {
      await createHousehold(name);
      onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create household.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.authCard}>
          <BrandMark />
          <Text style={styles.title}>Name your household</Text>
          <Text style={styles.subtitle}>Most families use their last name, but anything familiar works.</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="The Cragle Family"
            placeholderTextColor="#8790A3"
            autoCapitalize="words"
            style={styles.input}
            onSubmitEditing={submit}
          />
          {!!message && <Text style={styles.message}>{message}</Text>}
          <Pressable disabled={busy} onPress={submit} style={[styles.primaryButton, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create household</Text>}
          </Pressable>
          <Pressable onPress={signOut}><Text style={styles.textButton}>Use another account</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function BrandMark() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.logo}><Text style={styles.logoText}>⌂</Text></View>
      <Text style={styles.brand}>HomeThread</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F7FB' },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authCard: { width: '100%', maxWidth: 430, borderRadius: 28, backgroundColor: '#FFFFFF', padding: 24, shadowColor: '#26324A', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  logo: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#2257F4', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#FFFFFF', fontWeight: '900', fontSize: 23, marginTop: -4 },
  brand: { color: '#182033', fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  title: { color: '#182033', fontSize: 29, lineHeight: 34, fontWeight: '900', letterSpacing: -1 },
  subtitle: { color: '#687188', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#DDE1EA', backgroundColor: '#FAFBFD', color: '#182033', borderRadius: 15, paddingHorizontal: 15, fontSize: 15, marginBottom: 12 },
  message: { color: '#C44931', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  primaryButton: { minHeight: 52, borderRadius: 15, backgroundColor: '#2257F4', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  disabled: { opacity: 0.6 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  textButton: { color: '#2257F4', textAlign: 'center', fontWeight: '700', fontSize: 12, marginTop: 16 },
  switchText: { color: '#687188', textAlign: 'center', fontWeight: '700', fontSize: 12, marginTop: 22 },
});
