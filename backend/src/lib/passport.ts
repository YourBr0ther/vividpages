import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';

// Validate required environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
  console.warn('⚠️  Google OAuth environment variables not set. Google authentication will be disabled.');
}

// ============================================
// Google OAuth Strategy
// ============================================

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const googleId = profile.id;

          if (!email) {
            return done(new Error('No email found in Google profile'), undefined);
          }

          // Extract profile information
          const fullName = profile.displayName;
          const avatarUrl = profile.photos?.[0]?.value;

          // Check if user exists by Google ID or email
          const [existingUser] = await db
            .select()
            .from(users)
            .where(or(eq(users.googleId, googleId), eq(users.email, email)))
            .limit(1);

          if (existingUser) {
            // User exists - update Google ID and profile if needed
            const updates: any = {
              updatedAt: new Date(),
              lastLoginAt: new Date(),
            };

            // Link Google ID if not already linked
            if (!existingUser.googleId) {
              updates.googleId = googleId;
            }

            // Update profile information if provided
            if (fullName && !existingUser.fullName) {
              updates.fullName = fullName;
            }
            if (avatarUrl && !existingUser.avatarUrl) {
              updates.avatarUrl = avatarUrl;
            }

            // Mark email as verified since Google verified it
            if (!existingUser.emailVerified) {
              updates.emailVerified = true;
            }

            // Update user record
            const [updatedUser] = await db
              .update(users)
              .set(updates)
              .where(eq(users.id, existingUser.id))
              .returning();

            return done(null, updatedUser);
          } else {
            // New user - create account with Google OAuth
            const [newUser] = await db
              .insert(users)
              .values({
                email,
                googleId,
                fullName: fullName || null,
                avatarUrl: avatarUrl || null,
                emailVerified: true, // Google verified the email
                isActive: true,
                passwordHash: null, // No password for OAuth-only accounts
                lastLoginAt: new Date(),
              })
              .returning();

            return done(null, newUser);
          }
        } catch (error) {
          console.error('Google OAuth error:', error);
          return done(error as Error, undefined);
        }
      }
    )
  );
}

// ============================================
// Serialize/Deserialize User
// ============================================
// Note: We're using JWT tokens, so we don't need full session serialization
// These are required by passport but won't be used in production

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    done(null, user || null);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
