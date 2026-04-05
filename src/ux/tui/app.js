import React, { useEffect, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { useRouter } from './use-router.js';
import { Header } from './components/header.js';
import { Footer } from './components/footer.js';
import { ResultScreen } from './components/result.js';
import { FreshInstallScreen } from './screens/fresh-install.js';
import { HomeScreen } from './screens/home.js';
import { StatusScreen } from './screens/status.js';
import { PresetsScreen } from './screens/presets-list.js';
import { ProfileDetailScreen } from './screens/profile-detail.js';
import { CreateProfileWizard } from './screens/create-profile-wizard.js';
import { EditProfileWizard } from './screens/edit-profile-wizard.js';
import { ManageScreen } from './screens/manage.js';
import { SettingsScreen } from './screens/settings.js';
import { SddListScreen } from './screens/sdd-list.js';
import { SddDetailScreen } from './screens/sdd-detail.js';
import { SddCreateWizard } from './screens/sdd-create-wizard.js';
import { SddPhaseEditor } from './screens/sdd-phase-editor.js';
import { SddRoleEditor } from './screens/sdd-role-editor.js';
import { AgentIdentityEditor } from './screens/agent-identity-editor.js';
import { appendTuiDebug, resetTuiDebugLog } from '../../debug/tui-debug-log.js';

const h = React.createElement;

function App({ initialConfig, initialConfigPath }) {
  const { exit } = useApp();
  const router = useRouter(initialConfigPath ? 'home' : 'fresh-install');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState(null);
  const [config, setConfig] = useState(initialConfig);
  const [configPath, setConfigPath] = useState(initialConfigPath);
  const [selectedCatalog, setSelectedCatalog] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [selectedSdd, setSelectedSdd] = useState(null);

  useEffect(() => {
    appendTuiDebug('app_state', {
      screen: router.current,
      breadcrumb: router.breadcrumb,
      configPath,
      activePreset: config?.active_preset ?? null,
      selectedProfile,
      selectedCatalog,
    });
  }, [router.current, router.breadcrumb, configPath, config?.active_preset, selectedProfile, selectedCatalog]);

  // Global quit (only when not in text input screens)
  useInput((input, key) => {
    const textScreens = ['create-profile', 'edit-profile', 'sdd-create-wizard', 'sdd-list', 'sdd-detail', 'sdd-phase-editor', 'sdd-role-editor', 'agent-identity-editor'];
    if (input === 'q' && !textScreens.includes(router.current) && router.current !== 'result') {
      exit();
    }
    // Global ESC is handled by individual screens
  });

  const showResult = (text) => {
    appendTuiDebug('show_result', {
      screen: router.current,
      text,
    });
    setResult(text);
    router.push('result');
  };

  const reloadConfig = () => {
    appendTuiDebug('reload_config_start', {
      currentConfigPath: configPath,
      cwd: process.cwd(),
    });
    return import('../../router-config.js').then(mod => {
      try {
        const newConfigPath = mod.discoverConfigPath([process.cwd()]);
        if (newConfigPath) {
          const newConfig = mod.loadRouterConfig(newConfigPath);
          appendTuiDebug('reload_config_success', {
            requestedConfigPath: configPath,
            newConfigPath,
            activePreset: newConfig?.active_preset ?? null,
          });
          setConfig(newConfig);
          setConfigPath(newConfigPath);
        }
      } catch (error) {
        appendTuiDebug('reload_config_error', { error });
        /* stay with current */
      }
    });
  };

  const ctx = {
    config, configPath, router, setDescription,
    showResult, reloadConfig, exit,
    setConfig, setConfigPath,
    selectedCatalog, setSelectedCatalog,
    selectedProfile, setSelectedProfile,
    selectedSdd, setSelectedSdd,
    // Convenience: pass profile and catalog name to wizards
    profileName: selectedProfile,
    catalogName: selectedCatalog,
  };

  const screens = {
    'fresh-install': h(FreshInstallScreen, ctx),
    'home': h(HomeScreen, ctx),
    'status': h(StatusScreen, ctx),
    'presets': h(PresetsScreen, ctx),
    'profile-detail': h(ProfileDetailScreen, ctx),
    'create-profile': h(CreateProfileWizard, ctx),
    'edit-profile': h(EditProfileWizard, ctx),
    'manage': h(ManageScreen, ctx),
    'settings': h(SettingsScreen, ctx),
    'sdd-list': h(SddListScreen, ctx),
    'sdd-detail': h(SddDetailScreen, ctx),
    'sdd-create-wizard': h(SddCreateWizard, ctx),
    'sdd-phase-editor': h(SddPhaseEditor, ctx),
    'sdd-role-editor': h(SddRoleEditor, ctx),
    'agent-identity-editor': h(AgentIdentityEditor, ctx),
    'result': h(ResultScreen, { text: result, onBack: () => router.pop() }),
  };

  return h(Box, { flexDirection: 'column', width: '100%' },
    h(Header, { breadcrumb: router.breadcrumb, config }),
    h(Box, { flexDirection: 'column', paddingX: 2, paddingY: 1, flexGrow: 1 },
      screens[router.current] ?? h(Text, null, 'Unknown screen'),
    ),
    h(Footer, { description, canGoBack: router.canGoBack }),
  );
}

export async function startTui(configPath, config) {
  resetTuiDebugLog({
    configPath,
    activePreset: config?.active_preset ?? null,
  });
  const { waitUntilExit } = render(h(App, { initialConfig: config, initialConfigPath: configPath }), {
    exitOnCtrlC: true,
  });
  await waitUntilExit();
}
