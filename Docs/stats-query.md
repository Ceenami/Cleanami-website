## 📄 Documentation: Job Statistics Query Module

This server-side module provides a single, optimized function to fetch key aggregated statistics about all jobs in the database. It is designed to run efficiently and supply metrics for administrative dashboards.

-----

### **`getJobStats()`**

Fetches a comprehensive set of current statistics for the `jobs` table, including counts for total jobs, active jobs, today's jobs, and final statuses.

#### **Signature**

```typescript
export async function getJobStats(): Promise<{
  totalJobs: number;
  totalActive: number;
  totalToday: number;
  totalCompleted: number;
  totalCanceled: number;
}>
```

#### **Parameters**

  * This function takes **no parameters**. It uses the current date and time to calculate the "Today" metric.

#### **Process & Aggregations**

The function executes a single, highly efficient SQL query using Drizzle's custom aggregation helpers (`aggregations.countWhere`) to calculate multiple metrics simultaneously:

1.  **Date Range Calculation**:

      * It determines the start of the current day (`today`) and the start of the next day (`tomorrow`). This establishes a precise 24-hour window for the "Today" calculation.

2.  **Metric Calculation**:

| Metric | Calculation Logic |
| :--- | :--- |
| **`totalJobs`** | The total number of records in the `jobs` table. |
| **`totalActive`** | The total count of jobs whose status is one of: `'unassigned'`, `'assigned'`, or `'in-progress'`. |
| **`totalToday`** | The count of jobs scheduled to start (`checkInTime`) within the current calendar day (from 12:00 AM today to 11:59:59 PM today). |
| **`totalCompleted`** | The total count of jobs whose status is `'completed'`. |
| **`totalCanceled`** | The total count of jobs whose status is `'canceled'`. |

#### **Returns**

A promise resolving to a single object containing all five calculated job statistics as numbers.