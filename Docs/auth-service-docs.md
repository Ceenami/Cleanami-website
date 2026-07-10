# AuthService Documentation

## Overview

The `AuthService` class handles user authentication operations including sign-up and sign-in functionality. It integrates Supabase authentication with a custom database layer, ensuring data consistency through transactional rollback mechanisms.

## Architecture

The service coordinates between two data layers:
1. **Supabase Auth** - Handles authentication credentials and sessions
2. **Application Database** - Stores user profile and application-specific data

---

## Class: `AuthService`

### Constructor

```typescript
constructor(supabase: SupabaseClient, db: DrizzleClient)
```

**Parameters:**
- `supabase: SupabaseClient` - Supabase client instance for authentication
- `db: DrizzleClient` - Drizzle ORM database instance

**Example:**
```typescript
import { createClient } from '@supabase/supabase-js';
import { db } from '@/db';
import { AuthService } from './auth-service';

const supabase = createClient(supabaseUrl, supabaseKey);
const authService = new AuthService(supabase, db);
```

---

## Type Definitions

### `ServiceResponse<T>`

Generic response type for all service methods.

```typescript
type ServiceResponse<T> = 
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
```

**Success Response:**
- `success: true`
- `data: T` - The requested data

**Error Response:**
- `success: false`
- `data?: T` - Optional partial data (e.g., auth user before profile creation)
- `error.message: string` - Human-readable error message

---

## Public Methods

### `signUpUser(input: SignUpInput): Promise<ServiceResponse<AuthUser>>`

Creates a new user account with Supabase authentication and application database profile.

**Parameters:**
- `input: SignUpInput` - Object containing:
  - `email: string` - User email address
  - `password: string` - User password
  - `role?: string` - Optional user role

**Returns:**
- `Promise<ServiceResponse<AuthUser>>` - Service response with Supabase auth user

**Process Flow:**

```
1. Validate Input (signUpFormSchema)
        ↓
2. Create Supabase Auth User
        ↓
3. Create Database User Profile
        ↓
4a. SUCCESS: Return auth user
        OR
4b. FAILURE: Rollback auth user
        ↓
5. Return result
```

**Validation:**
- Uses Zod schema validation (`signUpFormSchema`)
- Returns formatted validation errors if input is invalid

**Transaction Safety:**
If database profile creation fails:
1. Attempts to delete the Supabase auth user (rollback)
2. Uses admin client for deletion
3. Logs critical error if rollback fails
4. Returns appropriate error message

**Error Scenarios:**

| Scenario | Response | Rollback |
|----------|----------|----------|
| Invalid input | Validation error | N/A |
| Auth creation fails | Auth error message | N/A |
| Profile creation fails | Database error | ✓ Auth user deleted |
| Rollback fails | Critical error message | ✗ Manual intervention needed |

**Usage Example:**

```typescript
const authService = new AuthService(supabase, db);

const result = await authService.signUpUser({
  email: 'user@example.com',
  password: 'SecurePass123!',
  role: 'customer'
});

if (result.success) {
  console.log('User created:', result.data.id);
  // Redirect to dashboard or send confirmation email
} else {
  console.error('Sign-up failed:', result.error.message);
  // Display error to user
}
```

**Success Response Example:**
```typescript
{
  success: true,
  data: {
    id: 'auth_user_uuid',
    email: 'user@example.com',
    created_at: '2025-10-07T...',
    // ... other Supabase user fields
  }
}
```

**Error Response Example:**
```typescript
{
  success: false,
  data: { /* partial auth user data */ },
  error: {
    message: 'Email already registered'
  }
}
```

---

### `signInUser(input: SignInInput): Promise<ServiceResponse<AuthUser>>`

Authenticates an existing user with email and password.

**Parameters:**
- `input: SignInInput` - Object containing:
  - `email: string` - User email address
  - `password: string` - User password

**Returns:**
- `Promise<ServiceResponse<AuthUser>>` - Service response with authenticated user

**Process Flow:**

```
1. Validate Input (signInFormSchema)
        ↓
2. Attempt Sign-In with Supabase
        ↓
3. Return Result (success or error)
```

**Validation:**
- Uses Zod schema validation (`signInFormSchema`)
- Returns formatted validation errors if input is invalid

**Usage Example:**

```typescript
const result = await authService.signInUser({
  email: 'user@example.com',
  password: 'SecurePass123!'
});

if (result.success) {
  console.log('User signed in:', result.data.id);
  // Set session, redirect to dashboard
} else {
  console.error('Sign-in failed:', result.error.message);
  // Display error (invalid credentials, etc.)
}
```

**Success Response Example:**
```typescript
{
  success: true,
  data: {
    id: 'auth_user_uuid',
    email: 'user@example.com',
    last_sign_in_at: '2025-10-07T...',
    // ... other Supabase user fields
  }
}
```

**Error Response Example:**
```typescript
{
  success: false,
  data: null,
  error: {
    message: 'Invalid login credentials'
  }
}
```

---

## Error Handling

### Error Types

**1. Validation Errors**
```typescript
// Invalid email format, weak password, etc.
{
  success: false,
  error: {
    message: "Invalid email address"
  }
}
```

**2. Authentication Errors**
```typescript
// Wrong credentials, user not found, etc.
{
  success: false,
  error: {
    message: "Invalid login credentials"
  }
}
```

**3. Database Errors**
```typescript
// Profile creation failed, constraint violations, etc.
{
  success: false,
  error: {
    message: "Database error: unique constraint violation"
  }
}
```

**4. Critical Errors**
```typescript
// Rollback failed - requires manual intervention
{
  success: false,
  error: {
    message: "A critical error occurred. Please contact support."
  }
}
```

### Error Logging

The service logs errors at different severity levels:

**Console Errors:**
- Database failures during sign-up
- Rollback failures (CRITICAL)
- Unexpected errors in try-catch blocks

**Console Logs:**
- Successful rollback operations

---

## Rollback Mechanism

### Sign-Up Rollback Strategy

When user profile creation fails after auth user creation:

```typescript
try {
  // Create auth user
  // Create database profile
} catch (dbError) {
  // Attempt rollback
  const supabaseAdmin = createAdminClient();
  await supabaseAdmin.auth.admin.deleteUser(authUser.id);
}
```

**Why Rollback is Necessary:**
- Prevents orphaned auth users without profiles
- Maintains data consistency
- Allows user to retry sign-up without conflicts

**Admin Client Requirement:**
- Regular Supabase client cannot delete users
- Admin client has elevated permissions
- Created via `createAdminClient()` helper

---

## Database Operations

### User Profile Creation

```typescript
const newUser: NewUser = {
  supabaseUserId: authUser.id,  // Link to Supabase auth
  email: authUser.email,
  // Additional fields as needed
};

await db.insert(users).values(newUser);
```

**Schema Requirements:**
- `supabaseUserId` must be unique (links to auth user)
- `email` stores user email for easy reference
- Additional fields can be added based on application needs

---

## Integration Examples

### React Component Integration

```typescript
'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/db';
import { AuthService } from './auth-service';

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const authService = new AuthService(supabase, db);

    const result = await authService.signUpUser({
      email,
      password,
      role: 'customer'
    });

    setLoading(false);

    if (result.success) {
      // Success - redirect to dashboard
      window.location.href = '/dashboard';
    } else {
      // Display error
      setError(result.error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Signing up...' : 'Sign Up'}
      </button>
    </form>
  );
}
```

### Server Action Integration

```typescript
'use server';

import { createServerClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { AuthService } from './auth-service';

export async function signUpAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = createServerClient();
  const authService = new AuthService(supabase, db);

  const result = await authService.signUpUser({
    email,
    password,
    role: 'customer'
  });

  if (!result.success) {
    return { error: result.error.message };
  }

  return { success: true, userId: result.data.id };
}
```

### API Route Integration

```typescript
// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/db';
import { AuthService } from '@/services/auth-service';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const authService = new AuthService(supabase, db);

  const result = await authService.signUpUser(body);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({ 
    success: true, 
    user: result.data 
  });
}
```

---

## Best Practices

### ✅ DO:

**Use consistent error handling:**
```typescript
const result = await authService.signUpUser(input);

if (result.success) {
  // Handle success
} else {
  // Handle error - always check result.error.message
}
```

**Validate input before submission:**
```typescript
// Client-side validation
if (!email || !password) {
  setError('Email and password required');
  return;
}

// Server-side validation happens automatically in service
```

**Handle loading states:**
```typescript
setLoading(true);
const result = await authService.signUpUser(input);
setLoading(false);
```

### ❌ DON'T:

**Assume success without checking:**
```typescript
// BAD
const result = await authService.signUpUser(input);
console.log(result.data.id); // May be undefined!

// GOOD
if (result.success) {
  console.log(result.data.id);
}
```

**Ignore error messages:**
```typescript
// BAD
if (!result.success) {
  alert('Error occurred');
}

// GOOD
if (!result.success) {
  alert(result.error.message); // Show specific error
}
```

**Skip admin client for rollback:**
```typescript
// BAD - Regular client cannot delete users
await supabase.auth.deleteUser(userId);

// GOOD - Use admin client
const admin = createAdminClient();
await admin.auth.admin.deleteUser(userId);
```

---

## Security Considerations

### Password Requirements
- Enforced by Zod schema validation (`signUpFormSchema`)
- Minimum length, complexity rules defined in schema
- Never store plain-text passwords (Supabase handles hashing)

### Admin Client Usage
- Only used for rollback operations
- Never expose admin credentials to client
- Always create admin client server-side

### Session Management
- Supabase handles session creation automatically
- Sessions stored in cookies (httpOnly recommended)
- Use `supabase.auth.getSession()` to retrieve session

---

## Dependencies

- `@supabase/supabase-js` - Supabase authentication client
- `@/db` - Drizzle ORM database instance
- `@/lib/validations/auth` - Zod validation schemas
- `@/lib/supabase/server` - Admin client factory
- `@/lib/utils` - Error formatting utilities
- `zod` - Schema validation

---

## Troubleshooting

### "User already registered" Error
**Cause:** Email already exists in Supabase auth  
**Solution:** Use sign-in instead, or implement password reset

### "Profile creation failed" Error
**Cause:** Database constraint violation or connection issue  
**Solution:** Check database schema, ensure unique constraints are valid

### "Critical error" Message
**Cause:** Rollback failed - orphaned auth user exists  
**Solution:** Manual intervention required - delete auth user via Supabase dashboard

### Session Not Persisting
**Cause:** Cookie settings or client initialization issue  
**Solution:** Ensure Supabase client properly configured with cookie storage

---

## Testing Examples

### Unit Test Example
```typescript
import { describe, it, expect, vi } from 'vitest';
import { AuthService } from './auth-service';

describe('AuthService', () => {
  it('should successfully sign up a new user', async () => {
    const mockSupabase = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: '123', email: 'test@example.com' } },
          error: null
        })
      }
    };

    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue({})
      })
    };

    const authService = new AuthService(mockSupabase as any, mockDb as any);

    const result = await authService.signUpUser({
      email: 'test@example.com',
      password: 'SecurePass123!',
      role: 'customer'
    });

    expect(result.success).toBe(true);
    expect(result.data.id).toBe('123');
  });
});
```