## 📜 Documentation: `validateIcalUrl`

This module provides a server-side function to validate an iCalendar (`.ics`) URL. It checks for a valid URL format, attempts to fetch and parse the calendar data, and verifies the presence of at least one event that ends in the future.

-----

### **Overview**

  * **File Context**: This code is intended to be run in a **server environment** (e.g., in a Next.js API route, a custom backend, or a Server Component), as indicated by `"use server"` (though it's an exported function and doesn't explicitly use server actions within the snippet, the comment suggests a server environment).
  * **Dependencies**: It uses the external library **`node-ical`** for fetching and parsing the iCalendar file and **`zod`** for robust URL validation.
  * **Purpose**: To confirm a given URL is a functional, future-relevant calendar link.

-----

### **`validateIcalUrl(url)` Function**

An asynchronous function that validates a given URL as a source for an iCalendar file with future events.

#### **Signature**

```typescript
export async function validateIcalUrl(url: string): Promise<ValidationResult>
```

#### **Parameters**

| Name | Type | Description |
| :--- | :--- | :--- |
| `url` | `string` | The URL of the iCalendar file (e.g., a Google or Outlook calendar link). |

#### **Returns**

A Promise that resolves to a **`ValidationResult`** object.

| Property | Type | Description |
| :--- | :--- | :--- |
| `status` | `string` | A status indicator for the validation. Possible values are: **`"valid"`**, **`"invalid_url"`**, or **`"no_future_events"`**. |
| `error` | `string` | **(Optional)** A descriptive error message, present only when `status` is **`"invalid_url"`** or a network/parsing error occurs. |

#### **`ValidationResult` Type Definition**

```typescript
type ValidationResult = {
  status: "valid" | "invalid_url" | "no_future_events";
  error?: string;
};
```

-----

### **Implementation Details**

The function performs the following steps:

1.  **URL Format Validation**: Uses the **`zod`** library to strictly check if the input `url` string adheres to a standard URL format.
2.  **iCal Fetch and Parse**: If the format is valid, it uses **`ical.async.fromURL(url)`** to attempt to fetch the file contents and parse it into structured event data. This step can fail if the URL is inaccessible, returns a non-iCal file, or the file is corrupted.
3.  **Future Event Check**: Iterates through all parsed events (`VEVENT`s). An event is considered "future" if its **`end`** time is greater than the current time (`new Date()`).
4.  **Error Handling**: Catches exceptions during fetching/parsing and returns an `"invalid_url"` status with a generic error message, logging the original error to the console for debugging.

#### **Potential Status Outcomes**

| Status Value | Description |
| :--- | :--- |
| **`"valid"`** | The URL is valid, the calendar was parsed, and at least one event is scheduled to end in the future. |
| **`"invalid_url"`** | The input string is not a valid URL, or the function failed to fetch/parse the content from the URL (network or parsing error). |
| **`"no_future_events"`** | The URL is valid and the file was parsed, but the calendar contains only past events or no events at all. |

-----

### **Example Usage**

Here's how you might use this function in a server environment (e.g., in a Next.js Server Action or API route):

```typescript
// Example usage in a server function

import { validateIcalUrl } from './path/to/your/validator';

async function handleSubmit(formData: FormData) {
  "use server"; // Indicates this runs on the server

  const url = formData.get('calendarUrl') as string;

  const result = await validateIcalUrl(url);

  if (result.status === "valid") {
    console.log("Success! Calendar URL is good to use.");
    // Proceed with saving the URL to the database
    return { success: true };
  } else if (result.status === "no_future_events") {
    // Tell the user why the link isn't useful right now
    return { success: false, message: "This calendar has no upcoming events." };
  } else {
    // Handle invalid URL or network/parsing errors
    // The result.error will contain a more specific message if available
    return { success: false, message: result.error || "The provided link is invalid or inaccessible." };
  }
}
```