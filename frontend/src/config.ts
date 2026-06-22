export const API_URL = import.meta.env.VITE_API_URL;

export const WS_URL = import.meta.env.VITE_WS_URL;

export const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
};

export const gameRules = {
  minBet: 1,
  maxBet: 1000,
} as const;

export const config = {
  apiUrl: API_URL,
  wsUrl: WS_URL,
  keycloak: keycloakConfig,
};

export default config;
