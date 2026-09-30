export interface SessionCredentials {
  csrf3Token?: string;
  userId?: string;
}

export interface SessionCredentialsStore {
  update(values: { csrf3Token?: string; userId?: string; urlUserId?: string }): void;
  get(): SessionCredentials;
}

// Update rules from legacy content.js:62-78 (spec §4.6). Never reset on course change.
export function createSessionCredentials(): SessionCredentialsStore {
  const credentials: SessionCredentials = {};

  return {
    update({ csrf3Token, userId, urlUserId }) {
      if (csrf3Token) credentials.csrf3Token = csrf3Token;
      if (userId) credentials.userId = userId;
      else if (urlUserId && !credentials.userId) credentials.userId = urlUserId;
    },
    get() {
      return { ...credentials };
    },
  };
}
