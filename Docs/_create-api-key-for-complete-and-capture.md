Creating an API key for the provided endpoint involves generating a **cryptographically secure random string** and then securely storing it in your server's environment and the client application (the Cleaner Mobile App). This key acts as a shared secret to authenticate the application and protect the endpoint from unauthorized access.

Here is the documentation on how to generate and implement the required API key:

-----

## 🔑 API Key Generation and Setup

This process creates the secret key that will be stored as `process.env.CLEANER_APP_API_KEY` on your server and used in the `X-API-Key` header by the mobile app.

### Step 1: Generate a Secure Key (Server Side)

You must use a secure method to generate a long, random hexadecimal string. This is typically done using Node.js's built-in `crypto` module.

Open your terminal or command prompt in your project's directory and run the following command:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Example Output:**

```
e4a8b7c2d1f6a9e0b3d5c7f9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9
```

**Result:** Copy the resulting 64-character hexadecimal string. This is your **API Key**.

-----

### Step 2: Configure the Server Environment (`.env` file)

Store the generated key in your project's environment variables (`.env` file).

1.  Open your project's **`.env`** file (or a similar environment configuration file).
2.  Add or update the variable name used in the endpoint's logic (`process.env.CLEANER_APP_API_KEY`).

<!-- end list -->

```dotenv
# .env file content
# ... other environment variables
STRIPE_SECRET_KEY=sk_live_********************
CLEANER_APP_API_KEY=e4a8b7c2d1f6a9e0b3d5c7f9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9
```

⚠️ **Security Note:** Ensure your `.gitignore` file includes `/.env` to prevent accidentally committing this secret key to your version control repository.

-----

### Step 3: Implement Key Usage (Client App)

The mobile application must securely store and send this key with every request to the "Job Completion & Payment Capture" endpoint.

1.  **Secure Storage:** The key should be stored in a **secure configuration** on the client (e.g., using a platform-specific secure storage like `react-native-keychain` for a React Native app) and not hardcoded into the source code or an insecure config file.
2.  **Request Header:** The client app must pass the key using the **`X-API-Key`** header, as required by the endpoint logic.

#### **Client-Side Request Example (JavaScript/TypeScript):**

```typescript
const completeJob = async (jobId: string) => {
  // 1. Retrieve the key from secure storage/config
  const CLEANER_API_KEY = "YOUR_SECRET_KEY_FROM_CONFIG"; // Replace with secure retrieval

  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/complete-and-capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 2. Pass the key in the required header
        'X-API-Key': CLEANER_API_KEY, 
      },
      body: JSON.stringify({ jobId }),
    });

    // ... handle response
  } catch (error) {
    // ... handle error
  }
};
```