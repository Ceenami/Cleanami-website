import type { User as AuthUser, SupabaseClient } from "@supabase/supabase-js";
import { signInFormSchema, signUpFormSchema } from "@/lib/validations/auth";
import { z } from "zod";
import { NewUser } from "@/lib/validations/schemas";
import { cleaners, users } from "@/db/schemas";
import { getAppBaseUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/server";
import { formatError } from "@/lib/utils";
import { getDbOrNull } from "@/db";
import type { SignUpRole } from "@/lib/validations/auth";
import {
  assertCleanerEmailApproved,
  CLEANER_SIGNUP_REJECTED_MESSAGE,
  logCleanerAuditEvent,
  markInvitationSignedUp,
} from "@/lib/queries/cleaner-invitations";

type DrizzleClient = typeof import("@/db").db;
type ServiceRespnse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      data?: T;
      error: {
        message: string;
      };
    };

async function syncUserMetadata(
  userId: string,
  role: SignUpRole,
  displayName: string
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const supabaseAdmin = createAdminClient();
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        role,
        full_name: displayName,
        name: displayName,
      },
    });
  } catch (metadataError) {
    console.warn("Could not sync user metadata via admin client:", metadataError);
  }
}

async function rollbackAuthUser(userId: string): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Cannot roll back auth user: SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
    return false;
  }

  try {
    const supabaseAdmin = createAdminClient();
    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error(
        "CRITICAL ERROR: Failed to roll back auth user after profile creation failure."
      );
      return false;
    }

    console.log(`Successfully rolled back auth user: ${userId}`);
    return true;
  } catch (error) {
    console.error("Failed to roll back auth user:", error);
    return false;
  }
}

export class AuthService {
  private supabase: SupabaseClient;
  private db: DrizzleClient;

  constructor(supabase: SupabaseClient, db: DrizzleClient) {
    this.supabase = supabase;
    this.db = db;
  }

  public async signUpUser(
    input: z.infer<typeof signUpFormSchema>
  ): Promise<ServiceRespnse<AuthUser>> {
    try {
      const validation = signUpFormSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          error: { message: formatError(validation.error) },
        };
      }

      const { email, password, role, name } = validation.data;
      const displayName = name?.trim() || email.split("@")[0];
      const normalizedEmail = email.toLowerCase();

      if (role === "user") {
        return {
          success: false,
          error: {
            message:
              "Customer accounts are created through the booking and payment flow. Please use Get Started on the homepage.",
          },
        };
      }

      if (role === "cleaner") {
        const database = getDbOrNull();
        if (!database) {
          return {
            success: false,
            error: {
              message:
                "Cleaner signup is temporarily unavailable. Please try again later.",
            },
          };
        }

        const { approved, invitation } =
          await assertCleanerEmailApproved(normalizedEmail);

        if (!approved || !invitation) {
          return {
            success: false,
            error: { message: CLEANER_SIGNUP_REJECTED_MESSAGE },
          };
        }
      }

      const signUpOptions: {
        data: {
          role: SignUpRole;
          full_name: string;
          name: string;
        };
        emailRedirectTo?: string;
      } = {
        data: {
          role,
          full_name: displayName,
          name: displayName,
        },
      };

      if (role === "cleaner") {
        signUpOptions.emailRedirectTo = `${getAppBaseUrl()}/auth/callback?next=${encodeURIComponent("/cleaner/onboarding")}`;
      }

      const { data: authData, error: authError } =
        await this.supabase.auth.signUp({
          email,
          password,
          options: signUpOptions,
        });

      if (authError) {
        return {
          success: false,
          data: authData.user!,
          error: { message: authError.message },
        };
      }

      if (!authData.user) {
        return {
          success: false,
          data: authData.user!,
          error: { message: "An unexpected Error occured during sign-up." },
        };
      }

      if (role === "cleaner" && !authData.session && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const supabaseAdmin = createAdminClient();
          await supabaseAdmin.auth.admin.updateUserById(authData.user.id, {
            email_confirm: true,
          });

          const { error: signInError } =
            await this.supabase.auth.signInWithPassword({
              email,
              password,
            });

          if (signInError) {
            console.warn(
              "Cleaner sign-up succeeded but could not establish session:",
              signInError.message
            );
          }
        } catch (confirmError) {
          console.warn("Could not auto-confirm cleaner email:", confirmError);
        }
      }

      const authUser = authData.user;
      const authUserWithRole: AuthUser = {
        ...authUser,
        user_metadata: {
          ...authUser.user_metadata,
          role,
          full_name: displayName,
          name: displayName,
        },
      };

      const database = getDbOrNull();
      if (!database) {
        console.warn(
          "DATABASE_URL not configured — created Supabase auth user only. Add DATABASE_URL to enable full app features."
        );

        await syncUserMetadata(authUser.id, role, displayName);

        return { success: true, data: authUserWithRole };
      }

      try {
        let invitationId: string | undefined;

        if (role === "cleaner") {
          const invitation = await database.query.cleanerInvitations.findFirst({
            where: (inv, { eq }) => eq(inv.email, normalizedEmail),
          });
          invitationId = invitation?.id;
        }

        let insertedCleanerId: string | undefined;

        await database.transaction(async (tx) => {
          const newUser: NewUser = {
            supabaseUserId: authUser.id,
            email: authUser.email!,
            role,
            name: displayName,
          };

          const [insertedUser] = await tx
            .insert(users)
            .values(newUser)
            .returning();

          if (role === "cleaner") {
            const now = new Date();
            const [insertedCleaner] = await tx
              .insert(cleaners)
              .values({
                userId: insertedUser.id,
                email: normalizedEmail,
                fullName: displayName,
                invitationId,
                onboardingStarted: true,
                onboardingStartedAt: now,
                accountStatus: "onboarding_in_progress",
              })
              .returning({ id: cleaners.id });

            insertedCleanerId = insertedCleaner.id;
          }
        });

        if (role === "cleaner" && invitationId && insertedCleanerId) {
          await markInvitationSignedUp(invitationId, insertedCleanerId);
          await logCleanerAuditEvent({
            action: "onboarding_started",
            cleanerId: insertedCleanerId,
            invitationId,
          });
        }

        await syncUserMetadata(authUser.id, role, displayName);

        return { success: true, data: authUserWithRole };
      } catch (dbError) {
        console.error(
          "Failed to create user profile, attempting to roll back auth user...",
          dbError
        );

        const rolledBack = await rollbackAuthUser(authUser.id);
        if (!rolledBack) {
          return {
            success: false,
            data: authUser,
            error: {
              message: "A critical error occurred. Please contact support.",
            },
          };
        }

        return {
          success: false,
          data: authUser,
          error: {
            message: formatError(dbError),
          },
        };
      }
    } catch (err) {
      console.error("Unexpected error in signUp:", formatError(err));
      return {
        success: false,
        error: {
          message: "An internal server error occurred.",
        },
      };
    }
  }

  public async signInUser(
    input: z.infer<typeof signInFormSchema>
  ): Promise<ServiceRespnse<AuthUser>> {
    try {
      const validation = signInFormSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          error: {
            message: formatError(validation.error),
          },
        };
      }

      const { email, password } = validation.data;

      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return {
          success: false,
          data: data.user!,
          error: {
            message: error.message,
          },
        };
      }
      return {
        success: true,
        data: data.user,
      };
    } catch (err) {
      console.error("Unexpected error in signIn:", formatError(err));
      return {
        success: false,
        error: {
          message: "An internal server error occurred.",
        },
      };
    }
  }
}
