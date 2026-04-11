// Business logic helpers (private, _ suffix)
// Placeholder for future features: progress tracking, weak-area detection, etc.

function getActiveEmail_() {
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}
