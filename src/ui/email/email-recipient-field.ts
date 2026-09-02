import { fetchEmailContacts, type EmailContact } from '../../email/client-drafts';

/** Debounce so a fast typist does not issue a query per keystroke. */
const SUGGEST_DELAY_MS = 120;

/** Below this, suggestions are noise rather than help. */
const MIN_QUERY_LENGTH = 2;

export interface RecipientFieldHandle {
  input: HTMLInputElement;
  root: HTMLElement;
  destroy(): void;
}

/** Split a recipient line into tokens, keeping the caret's token separate. */
export function splitRecipients(value: string): { committed: string[]; active: string } {
  const parts = value.split(',');
  const active = parts.pop() ?? '';
  return {
    committed: parts.map((part) => part.trim()).filter(Boolean),
    active: active.trim(),
  };
}

/** Replace the token under the caret with a chosen contact. */
export function applyRecipientChoice(value: string, header: string): string {
  const { committed } = splitRecipients(value);
  return [...committed, header].join(', ') + ', ';
}

export function createRecipientField(options: {
  accountId: string;
  placeholder: string;
  name: string;
}): RecipientFieldHandle {
  const root = document.createElement('div');
  root.className = 'email-recipient-field';

  const input = document.createElement('input');
  input.className = 'email-input';
  input.placeholder = options.placeholder;
  input.name = options.name;
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  const list = document.createElement('ul');
  list.className = 'email-recipient-suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  root.append(input, list);

  let contacts: EmailContact[] = [];
  let activeIndex = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;
  let destroyed = false;

  const close = (): void => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    contacts = [];
    activeIndex = -1;
  };

  const choose = (contact: EmailContact): void => {
    input.value = applyRecipientChoice(input.value, contact.header);
    close();
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const paint = (): void => {
    list.replaceChildren();
    contacts.forEach((contact, index) => {
      const item = document.createElement('li');
      item.className = 'email-recipient-suggestion';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.classList.toggle('is-active', index === activeIndex);

      const name = document.createElement('span');
      name.className = 'email-recipient-suggestion-name';
      name.textContent = contact.name || contact.address;
      const address = document.createElement('span');
      address.className = 'email-recipient-suggestion-address';
      address.textContent = contact.name ? contact.address : '';
      item.append(name, address);

      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(contact);
      });
      list.appendChild(item);
    });
    list.hidden = contacts.length === 0;
    input.setAttribute('aria-expanded', String(contacts.length > 0));
  };

  const suggest = (): void => {
    const { active } = splitRecipients(input.value);
    if (active.length < MIN_QUERY_LENGTH) {
      close();
      return;
    }

    const seq = ++requestSeq;
    void fetchEmailContacts(options.accountId, active)
      .then((rows) => {
        if (destroyed || seq !== requestSeq) return;
        contacts = rows;
        activeIndex = rows.length ? 0 : -1;
        paint();
      })
      .catch(() => {
        if (!destroyed && seq === requestSeq) close();
      });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(suggest, SUGGEST_DELAY_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden || contacts.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % contacts.length;
      paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + contacts.length) % contacts.length;
      paint();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (activeIndex >= 0) {
        event.preventDefault();
        choose(contacts[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!destroyed) close();
    }, 0);
  });

  return {
    input,
    root,
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      close();
    },
  };
}
