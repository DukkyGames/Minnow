import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldShowAgentTabActivityBadge,
  shouldSwitchToAgentTab,
} from '../../src/ui/terminal-agent-follow-policy.ts';

describe('terminal-agent-follow-policy', () => {
  it('does not switch to Agent tab when auto-follow is off and run is agent-driven', () => {
    assert.equal(
      shouldSwitchToAgentTab({
        panelOpen: true,
        userInitiated: false,
        autoFollowAgentTab: false,
      }),
      false,
    );
  });

  it('switches to Agent tab when auto-follow is enabled', () => {
    assert.equal(
      shouldSwitchToAgentTab({
        panelOpen: true,
        userInitiated: false,
        autoFollowAgentTab: true,
      }),
      true,
    );
  });

  it('switches to Agent tab for user-initiated history loads', () => {
    assert.equal(
      shouldSwitchToAgentTab({
        panelOpen: true,
        userInitiated: true,
        autoFollowAgentTab: false,
      }),
      true,
    );
  });

  it('never switches when the panel is closed', () => {
    assert.equal(
      shouldSwitchToAgentTab({
        panelOpen: false,
        userInitiated: true,
        autoFollowAgentTab: true,
      }),
      false,
    );
  });

  it('shows Agent tab badge only when panel is open on another tab', () => {
    assert.equal(
      shouldShowAgentTabActivityBadge({
        panelOpen: true,
        activeTabKind: 'pty',
        activityDepth: 1,
      }),
      true,
    );
    assert.equal(
      shouldShowAgentTabActivityBadge({
        panelOpen: true,
        activeTabKind: 'agent',
        activityDepth: 1,
      }),
      false,
    );
    assert.equal(
      shouldShowAgentTabActivityBadge({
        panelOpen: false,
        activeTabKind: 'pty',
        activityDepth: 1,
      }),
      false,
    );
  });
});
