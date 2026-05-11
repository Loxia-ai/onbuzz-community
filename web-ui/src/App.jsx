import React, { useEffect, useState, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Chat from './components/Chat.jsx';
import AgentManager from './components/AgentManager.jsx';
import FlowsPage from './components/Flows/FlowsPage.jsx';
import SchedulesPage from './components/SchedulesPage.jsx';
import SkillsPage from './components/SkillsPage.jsx';
import Settings from './components/Settings.jsx';
import VisualEditorPage from './pages/VisualEditorPage.jsx';
// widget-module: remove this line if the module is deleted.
import { WidgetAuditPage, WidgetGalleryPage } from './modules/widget';
import AttentionRequiredModal from './components/AttentionRequiredModal.jsx';
import OnboardingFlow from './components/onboarding/OnboardingFlow.jsx';
import UpdateNotificationBar from './components/UpdateNotificationBar.jsx';
import { useAppStore } from './stores/appStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useConsent } from './hooks/useConsent.js';
import { useAttentionRequired, ISSUE_TYPES } from './hooks/useAttentionRequired.js';
import { useOnboarding } from './hooks/useOnboarding.js';
import { initializeClarity, upgradeConsent } from './utils/clarity.js';
import LoadingSpinner from './components/LoadingSpinner.jsx';
import { brand, applyBrand } from './config/brand.js';

// Version check interval: 1 hour in milliseconds
const VERSION_CHECK_INTERVAL = 60 * 60 * 1000;

function App() {
  const { initialized, initialize, checkForUpdates } = useAppStore();
  const [loading, setLoading] = useState(true);

  // Consent management (for Clarity initialization)
  const { consentLevel, hasConsented } = useConsent();

  // Unified attention required management
  const { issues, showModal, closeModal, resolveIssue } = useAttentionRequired();

  // First-run onboarding (3-step wizard). Privacy consent is a hard
  // pre-gate — even on a fresh install, the AttentionRequiredModal must
  // resolve consent before the wizard appears. After consent is granted
  // the wizard takes over and suppresses the modal for the remaining
  // provider/key path.
  const { shouldShow: showOnboarding, completeOnboarding, dismissOnboarding } =
    useOnboarding();

  // Consent is the only issue we let pre-empt onboarding. Anything else
  // (e.g. API_KEY_MISSING) is the wizard's job to resolve first.
  const needsPrivacyConsent = issues.some(
    (issue) => issue.type === ISSUE_TYPES.PRIVACY_CONSENT,
  );
  const shouldRenderOnboarding = showOnboarding && !needsPrivacyConsent;
  // Pre-onboarding gate: modal is only allowed to surface the consent
  // issue. Even if API_KEY_MISSING is queued, the wizard handles that.
  const shouldRenderConsentGate = showModal && needsPrivacyConsent;
  // Post-onboarding modal: anything left after the wizard is done
  // (provider key reminders, etc.) goes through here as before.
  const shouldRenderPostOnboardingModal =
    showModal &&
    !shouldRenderConsentGate &&
    !shouldRenderOnboarding &&
    issues.length > 0;
  const shouldRenderAttentionModal =
    shouldRenderConsentGate || shouldRenderPostOnboardingModal;
  // While the consent gate is up, scope the modal to that single issue
  // so it cannot advance to the legacy "Provider Key Required" step
  // before the wizard appears. Outside the gate the modal sees every
  // open issue normally.
  const modalIssues = shouldRenderConsentGate
    ? issues.filter((issue) => issue.type === ISSUE_TYPES.PRIVACY_CONSENT)
    : issues;

  // Initialize WebSocket connection
  useWebSocket();

  useEffect(() => {
    // Apply brand colors, favicon, and title before anything renders
    applyBrand();

    const initApp = async () => {
      setLoading(true);
      try {
        await initialize();
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setLoading(false);
      }
    };

    initApp();
  }, [initialize]);

  // Initialize Clarity when consent changes
  useEffect(() => {
    if (hasConsented) {
      initializeClarity(consentLevel);
      upgradeConsent(consentLevel);
    }
  }, [hasConsented, consentLevel]);

  // Version check on startup and every hour
  useEffect(() => {
    if (!initialized) return;

    // Check for updates on startup
    checkForUpdates();

    // Set up hourly interval check
    const intervalId = setInterval(() => {
      checkForUpdates();
    }, VERSION_CHECK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [initialized, checkForUpdates]);

  if (loading || !initialized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="large" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            Starting {brand.fullProductName}
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Initializing AI agents system...
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Visual Editor Page - separate window, no layout */}
      <Route path="/visual-editor" element={<VisualEditorPage />} />

      {/* Main App with Layout */}
      <Route path="/*" element={
        <>
          {/* Privacy consent is the only pre-onboarding gate. While
              that gate is active, the modal sees only the consent
              issue — API_KEY_MISSING is left for the wizard to handle.
              After onboarding (or whenever the wizard doesn't apply)
              the modal surfaces any remaining issues normally. */}
          {shouldRenderAttentionModal && (
            <AttentionRequiredModal
              issues={modalIssues}
              onResolve={resolveIssue}
              onClose={() => closeModal(true)}
            />
          )}

          {/* First-run onboarding wizard. Renders above the rest of the
              UI only after privacy consent is resolved. */}
          {shouldRenderOnboarding && (
            <OnboardingFlow
              onComplete={completeOnboarding}
              onSkip={dismissOnboarding}
            />
          )}

          {/* Update notification bar - appears at top when update available */}
          <UpdateNotificationBar />

          <Layout>
            <Routes>
              <Route path="/" element={<Chat />} />
              <Route path="/agents" element={<AgentManager />} />
              <Route path="/flows" element={<FlowsPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/settings" element={<Settings />} />
              {/* widget-module: remove these two lines if the module is deleted. */}
              <Route path="/widget-audit" element={<WidgetAuditPage />} />
              <Route path="/widget-gallery" element={<WidgetGalleryPage />} />
            </Routes>
          </Layout>
        </>
      } />
    </Routes>
  );
}

export default App;