// scripts/apply-sql-migration.ts
// Run with: tsx scripts/apply-sql-migration.ts
import { config } from 'dotenv';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

config({ path: '.env.local' }); // or .env.local

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  process.exit(1);
}



async function applyMigration() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  
  try {
    console.log('📂 Reading migration file...');
    
    // Read the SQL migration file
    const migrationPath = join(__dirname, '../db/schemas/functions_for_app.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('🚀 Applying SQL functions and triggers...');
    
    // Execute the migration
    await sql.unsafe(migrationSQL);
    
    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('Created functions:');
    console.log('  - update_updated_at_column()');
    console.log('  - handle_new_cleaner_user()');
    console.log('  - job_has_assignments()');
    console.log('  - get_cleaner_swap_count()');
    console.log('  - check_swap_eligibility()');
    console.log('  - calculate_reliability_score()');
    console.log('  - calculate_lateness_penalty()');
    console.log('  - get_leaderboard()');
    console.log('  - send_reliability_notifications()');
    console.log('  - handle_reliability_response()');
    console.log('  - create_job_reminders()');
    console.log('');
    console.log('Created triggers:');
    console.log('  - update_cleaners_updated_at');
    console.log('  - update_swap_requests_updated_at');
    console.log('  - update_onboarding_documents_updated_at');
    console.log('  - update_capability_flags_updated_at');
    console.log('  - update_reliability_checks_updated_at');
    console.log('  - on_auth_user_created_cleaner');
    console.log('  - create_job_reminders_trigger');
    
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

applyMigration();