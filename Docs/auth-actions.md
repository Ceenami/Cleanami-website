## 📄 Documentation: Authentication Server Actions

This server module provides the core logic for user authentication using **Supabase** and handles redirection and cache management within a Next.js application. It leverages a dedicated `AuthService` for interacting with the database and authentication provider.

-----

### **`signOut()`**

A simple server action to terminate the user's session.

#### **Signature**

```typescript
export async function signOut()
```

#### **Purpose**

1.  Initializes the Supabase server client.
2.  Calls `supabase.auth.signOut()` to clear the authentication session.
3.  **Immediately redirects** the user to the root path (`/`).

#### **Returns**

  * `Redirect` to the home page (`/`).

-----

### **`signUpUser(prevState, formData)`**

A server action to handle user registration with email and password.

#### **Signature**

```typescript
export async function signUpUser(
  prevState: AuthUserForm | undefined,
  formData: FormData
)
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `prevState` | `AuthUserForm \| undefined` | The previous state object returned by this action (used by `useFormState` for displaying errors). |
| `formData` | `FormData` | The form data containing `email`, `password`, and `confirm-password` fields. |

#### **Process & Logic**

1.  **Input Validation**: Parses the `formData` against the **`signUpFormSchema`**. Returns an error object if validation fails (e.g., mismatching passwords or invalid format).
2.  **Service Call**: Instantiates `AuthService` and calls **`authService.signUpUser()`** with the validated credentials.
3.  **Failure Handling**: If the service call fails (e.g., email already exists or provider error), it returns a generic error message.
4.  **Success & Redirection**: If successful, it determines the user's role from the metadata:
      * If the role is `"user"`, it **invalidates the cache for (`/customer/dashboard`)** and redirects the user to the customer dashboard.
      * If the role is `"admin"`, it **invalidates the cache for (`/admin/dashboard`)** and redirects the user to the admin dashboard.

#### **Returns**

  * On validation or authentication failure: An object containing `success: false`, the submitted email, and an `error` message.
  * On success: A `Redirect` to the appropriate dashboard path.

-----

### **`signInUser(prevState, formData)`**

A server action to handle user login with email and password.

#### **Signature**

```typescript
export async function signInUser(
  prevState: AuthUserForm | undefined,
  formData: FormData
)
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `prevState` | `AuthUserForm \| undefined` | The previous state object returned by this action (for `useFormState`). |
| `formData` | `FormData` | The form data containing `email` and `password` fields. |

#### **Process & Logic**

1.  **Input Validation**: Parses the `formData` against the **`signInFormSchema`**. Returns an error object if validation fails.
2.  **Service Call**: Instantiates `AuthService` and calls **`authService.signInUser()`** with the validated credentials.
3.  **Failure Handling**: If the service call fails (e.g., incorrect credentials), it returns a generic error message.
4.  **Success & Redirection**: If successful, it checks the user's role:
      * If the role is `"user"`, it **invalidates the cache for (`/customer/dashboard`)** and redirects to the customer dashboard.
      * If the role is `"admin"` or `"super_admin"`, it **invalidates the cache for (`/admin/dashboard`)** and redirects to the admin dashboard.

#### **Returns**

  * On validation or authentication failure: An object containing `success: false`, the submitted email, and an `error` message.
  * On success: A `Redirect` to the appropriate dashboard path.