/**
 * tokens.ts — signs and verifies the API's access tokens (JWT, HS256, via jose).
 *
 * What: `sign(userId)` issues a short-lived token; `verify(token)` returns the user id.
 * Why:  login is out of scope (agreed assumption), but authorization needs a
 *       verifiable identity on every request. The token carries ONLY the user id
 *       (`sub`); organization roles are read from the database on every request, so
 *       a role change applies immediately and a token can't carry stale privileges.
 * Who:  app.ts (verifies the Authorization header) and the dev-only /dev/users route
 *       (issues tokens for seeded users). Moving to a real identity provider means
 *       swapping verify() for jose's createRemoteJWKSet (RS256) — nothing else changes.
 */
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'taskboard-api';
const AUDIENCE = 'taskboard-web';
const LIFETIME = '12h';

export interface TokenService {
  sign(userId: string): Promise<string>;
  /** Returns the user id; throws if the token is invalid, expired or for another audience. */
  verify(token: string): Promise<string>;
}

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);
  return {
    sign: (userId) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(LIFETIME)
        .sign(key),

    async verify(token) {
      // Pinning the algorithm rejects tokens that claim "alg": "none" or switch algorithms.
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload.sub !== 'string') throw new Error('token has no subject');
      return payload.sub;
    },
  };
}
