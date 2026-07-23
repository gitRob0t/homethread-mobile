import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recordAppEvent } from '../services/telemetry';

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void recordAppEvent('mobile_render_crash', {
      severity: 'error',
      properties: {
        errorName: error.name,
        errorSummary: error.message,
        componentStack: info.componentStack?.slice(0, 2_000),
      },
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.page}>
        <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
        <Text style={styles.title}>Coho hit a snag.</Text>
        <Text style={styles.detail}>Your family data is safe. Try this screen again; if it repeats, the failure has been recorded for repair.</Text>
        <Pressable onPress={() => this.setState({ failed: false })} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101624' },
  mark: { width: 62, height: 62, borderRadius: 21, backgroundColor: '#7047EE', alignItems: 'center', justifyContent: 'center' },
  markText: { color: '#fff', fontSize: 25, fontWeight: '900' },
  title: { color: '#fff', fontSize: 25, fontWeight: '900', marginTop: 20 },
  detail: { color: '#AEB8CB', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 360 },
  button: { minHeight: 48, borderRadius: 15, backgroundColor: '#6687FF', paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
});
