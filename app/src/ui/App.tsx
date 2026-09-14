import { EnvironmentPanel } from './EnvironmentPanel.tsx';

export function App() {
  return (
    <main>
      <h1>WPStudBook</h1>
      <p data-testid="app-version">版本 {__APP_VERSION__}</p>
      <EnvironmentPanel />
    </main>
  );
}
