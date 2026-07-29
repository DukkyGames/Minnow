/**
 * Host-side pairing QR and named companion-device management.
 */

import { toCanvas } from 'qrcode';
import {
  createPairing,
  fetchCompanionDevices,
  revokeCompanionDevice,
  type CompanionDevice,
} from '../api/device-auth.ts';
import { appConfirm } from './app-dialog.ts';
import { setStatus } from './status.ts';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatPairedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Paired previously';
  return `Paired ${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Render pairing controls below the LAN URL list. */
export function renderCompanionDevices(mount: HTMLElement, lanActive: boolean): void {
  const section = element('section', 'settings-network-devices');
  const title = element('h3', 'settings-network-devices__title', 'Companion devices');
  const description = element(
    'p',
    'settings-field-hint',
    'Create a five-minute QR link for one phone or tablet. Each named device can be revoked independently.',
  );

  const form = element('div', 'settings-network-device-form');
  const label = element('label', 'settings-label', 'Device name');
  label.htmlFor = 'settingsCompanionDeviceName';
  const input = element('input', 'settings-input') as HTMLInputElement;
  input.id = 'settingsCompanionDeviceName';
  input.maxLength = 64;
  input.placeholder = 'e.g. Living room iPad';
  input.autocomplete = 'off';
  const pairButton = element('button', 'settings-action-btn', 'Create pairing QR');
  pairButton.type = 'button';
  pairButton.disabled = !lanActive;
  form.append(label, input, pairButton);

  const inactiveHint = element(
    'p',
    'settings-field-hint settings-network-devices__inactive',
    'Restart Minnow in Local network mode before creating a pairing.',
  );
  inactiveHint.hidden = lanActive;

  const qrRegion = element('div', 'settings-network-qr');
  qrRegion.hidden = true;
  qrRegion.setAttribute('role', 'status');
  const canvas = element('canvas', 'settings-network-qr__canvas');
  const qrCopy = element('div', 'settings-network-qr__copy');
  const qrTitle = element('strong', '', 'Scan with your device');
  const qrExpiry = element('span', 'settings-network-qr__expiry');
  const qrLink = element('code', 'settings-network-qr__link');
  qrCopy.append(qrTitle, qrExpiry, qrLink);
  qrRegion.append(canvas, qrCopy);

  const listTitle = element('h4', 'settings-network-devices__list-title', 'Paired devices');
  const list = element('ul', 'settings-network-device-list');
  const listState = element('p', 'settings-field-hint', 'Loading devices…');
  section.append(title, description, form, inactiveHint, qrRegion, listTitle, listState, list);
  mount.appendChild(section);

  async function refreshDevices(): Promise<void> {
    try {
      const devices = await fetchCompanionDevices();
      list.replaceChildren();
      listState.hidden = devices.length > 0;
      listState.textContent = devices.length ? '' : 'No devices paired yet.';
      for (const device of devices) list.appendChild(renderDevice(device));
    } catch {
      listState.hidden = false;
      listState.textContent = 'Could not load paired devices.';
    }
  }

  function renderDevice(device: CompanionDevice): HTMLLIElement {
    const item = element('li', 'settings-network-device');
    const identity = element('span', 'settings-network-device__identity');
    identity.append(
      element('strong', 'settings-network-device__name', device.name),
      element('span', 'settings-network-device__date', formatPairedDate(device.createdAt)),
    );
    const revoke = element('button', 'settings-inline-btn', 'Revoke');
    revoke.type = 'button';
    revoke.addEventListener('click', async () => {
      const confirmed = await appConfirm(
        `Revoke ${device.name}? The device will lose access on its next request.`,
        { title: 'Revoke companion device', confirmLabel: 'Revoke', danger: true },
      );
      if (!confirmed) return;
      revoke.disabled = true;
      try {
        await revokeCompanionDevice(device.id);
        await refreshDevices();
        setStatus('ok', `${device.name} revoked`);
      } catch {
        revoke.disabled = false;
        setStatus('err', `Could not revoke ${device.name}`);
      }
    });
    item.append(identity, revoke);
    return item;
  }

  pairButton.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) {
      input.focus();
      setStatus('err', 'Enter a device name');
      return;
    }
    pairButton.disabled = true;
    try {
      const pairing = await createPairing(name);
      const url = pairing.urls[0];
      if (!url) throw new Error('No LAN URL is available');
      await toCanvas(canvas, url, {
        width: 192,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      qrExpiry.textContent = `Expires ${new Date(pairing.expiresAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`;
      qrLink.textContent = url;
      qrRegion.hidden = false;
      setStatus('ok', 'Pairing QR ready');
    } catch {
      qrRegion.hidden = true;
      setStatus('err', 'Could not create pairing QR');
    } finally {
      pairButton.disabled = !lanActive;
    }
  });

  void refreshDevices();
}

