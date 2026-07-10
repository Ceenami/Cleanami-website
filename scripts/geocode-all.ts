
import { geocodeAllCleaners, geocodeAllProperties } from "@/lib/services/google-maps/geocoding";

export async function geocode() {
  console.log('🗺️  Geocoding all addresses...\n');
  
  console.log('Geocoding cleaners...');
  await geocodeAllCleaners((current, total) => {
    console.log(`  Progress: ${current}/${total} (${Math.round(current/total*100)}%)`);
  });
  
  console.log('\nGeocoding properties...');
  await geocodeAllProperties((current, total) => {
    console.log(`  Progress: ${current}/${total} (${Math.round(current/total*100)}%)`);
  });
  
  console.log('\n✅ All addresses geocoded!');
  process.exit(0);
}

geocode().catch(console.error);