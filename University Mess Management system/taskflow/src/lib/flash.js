// One-shot notice that survives a redirect but is consumed on the next read.
//
// sessionStorage is used rather than router state so a message handed over by a
// form or a route guard still renders after the redirect, and so it does not
// linger in a history entry and reappear on the back button.

const FLASH_KEY = "mess_flash_notice";

export function setFlashNotice(message) {
  try {
    window.sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // Private mode or a full quota: the notice is a nicety, not critical.
  }
}

export function consumeFlashNotice() {
  try {
    const value = window.sessionStorage.getItem(FLASH_KEY);

    if (value) {
      window.sessionStorage.removeItem(FLASH_KEY);
    }

    return value ?? "";
  } catch {
    return "";
  }
}
