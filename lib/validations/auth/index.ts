import { z } from 'zod';

export const signInFormSchema = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const signUpRoleSchema = z.enum(['user', 'cleaner']);

export type SignUpRole = z.infer<typeof signUpRoleSchema>;

export const signUpFormSchema = z
  .object({
    email: z.email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z
      .string()
      .min(6, 'Confirm password must be at least 6 characters'),
    role: signUpRoleSchema.default('cleaner'),
    name: z.string().trim().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })
  .refine(
    (data) =>
      data.role !== 'cleaner' ||
      (data.name !== undefined && data.name.length >= 2),
    {
      message: 'Full name is required for cleaner accounts',
      path: ['name'],
    }
  );