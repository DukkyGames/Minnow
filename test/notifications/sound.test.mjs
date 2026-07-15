import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('notification sound gating', () => {
  let prefs;
  let sound;
  let win;
  let doc;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    doc = win.document;
    const g = globalThis;
    g.window = win;
    g.document = doc;
    g.localStorage = win.localStorage;
    prefs = await import('../../src/notifications/prefs.ts');
    sound = await import('../../src/notifications/sound.ts');
    prefs.resetNotificationPrefsForTests();
    sound.resetNotificationSoundForTests();
    win.localStorage.clear();
    delete win.minnow;
  });

  afterEach(() => {
    prefs.resetNotificationPrefsForTests();
    sound.resetNotificationSoundForTests();
  });

  function setFocusState({ hasFocus, visibilityState }) {
    Object.defineProperty(doc, 'hasFocus', {
      configurable: true,
      value: () => hasFocus,
    });
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      value: visibilityState,
    });
  }

  test('does not play when focused', () => {
    setFocusState({ hasFocus: true, visibilityState: 'visible' });
    assert.equal(sound.shouldPlayNotificationSound(), false);
  });

  test('does not play when sound disabled', () => {
    setFocusState({ hasFocus: false, visibilityState: 'hidden' });
    prefs.saveNotificationPref('soundEnabled', false);
    assert.equal(sound.shouldPlayNotificationSound(), false);
  });

  test('does not play when muted', () => {
    setFocusState({ hasFocus: false, visibilityState: 'hidden' });
    prefs.saveNotificationPref('muted', true);
    assert.equal(sound.shouldPlayNotificationSound(), false);
  });

  test('browser: skips hidden background tabs when unfocused', () => {
    setFocusState({ hasFocus: false, visibilityState: 'hidden' });
    assert.equal(sound.shouldPlayNotificationSound(), false);
  });

  test('browser: plays when visible and unfocused', () => {
    setFocusState({ hasFocus: false, visibilityState: 'visible' });
    assert.equal(sound.shouldPlayNotificationSound(), true);
  });

  test('electron: plays when unfocused even if visibility is hidden', () => {
    win.minnow = { app: { isElectron: true } };
    setFocusState({ hasFocus: false, visibilityState: 'hidden' });
    assert.equal(sound.shouldPlayNotificationSound(), true);
  });

  test('chat_question: plays when window is focused', () => {
    setFocusState({ hasFocus: true, visibilityState: 'visible' });
    assert.equal(sound.shouldPlayNotificationSound(), false);
    assert.equal(sound.shouldPlayNotificationSound('chat_question'), true);
  });
});
