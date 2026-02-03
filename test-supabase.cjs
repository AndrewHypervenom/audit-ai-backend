// ============================================
// USO:
// Ejecutar: node backend/test-supabase.js
// ============================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Testing Supabase Connection...\n');
console.log('📋 Configuration:');
console.log(`   URL: ${SUPABASE_URL}`);
console.log(`   Service Role Key: ${SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20)}...`);
console.log('');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: Missing environment variables!');
  console.error('   Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testConnection() {
  try {
    console.log('🧪 Test 1: Querying audits table...');
    const { data: audits, error: auditsError } = await supabase
      .from('audits')
      .select('id, executive_name, status')
      .limit(5);

    if (auditsError) {
      console.error('❌ Error querying audits:', auditsError);
    } else {
      console.log(`✅ Success! Found ${audits.length} audits`);
      console.log('   Sample:', audits[0]);
    }

    console.log('\n🧪 Test 2: Querying api_costs table directly...');
    const { data: costs, error: costsError } = await supabase
      .from('api_costs')
      .select('*')
      .limit(5);

    if (costsError) {
      console.error('❌ Error querying api_costs:', costsError);
      console.error('   This is likely the problem!');
      console.error('   Error details:', JSON.stringify(costsError, null, 2));
    } else {
      console.log(`✅ Success! Found ${costs.length} cost records`);
      if (costs.length > 0) {
        console.log('   Sample:', costs[0]);
      } else {
        console.log('   ⚠️  No cost records found in database');
      }
    }

    console.log('\n🧪 Test 3: Querying audits WITH api_costs (LEFT JOIN)...');
    const { data: auditsWithCosts, error: joinError } = await supabase
      .from('audits')
      .select('id, executive_name, status, api_costs(*)')
      .limit(5);

    if (joinError) {
      console.error('❌ Error with JOIN query:', joinError);
      console.error('   Error details:', JSON.stringify(joinError, null, 2));
    } else {
      console.log(`✅ Success! Found ${auditsWithCosts.length} audits`);
      
      auditsWithCosts.forEach((audit, index) => {
        console.log(`\n   Audit ${index + 1}:`);
        console.log(`   - ID: ${audit.id}`);
        console.log(`   - Name: ${audit.executive_name}`);
        console.log(`   - Status: ${audit.status}`);
        console.log(`   - api_costs exists: ${!!audit.api_costs}`);
        
        if (audit.api_costs) {
          console.log(`   - api_costs type: ${typeof audit.api_costs}`);
          console.log(`   - Is array: ${Array.isArray(audit.api_costs)}`);
          console.log(`   - Length: ${audit.api_costs.length}`);
          
          if (Array.isArray(audit.api_costs) && audit.api_costs.length > 0) {
            console.log(`   - total_cost: $${audit.api_costs[0].total_cost}`);
          } else {
            console.log('   ⚠️  api_costs is empty array');
          }
        } else {
          console.log('   ❌ api_costs is null/undefined');
        }
      });

      // Calcular total
      const auditsWithValidCosts = auditsWithCosts.filter(a => 
        a.api_costs && 
        Array.isArray(a.api_costs) && 
        a.api_costs.length > 0 &&
        a.api_costs[0].total_cost
      );

      console.log(`\n   📊 Summary:`);
      console.log(`   - Total audits: ${auditsWithCosts.length}`);
      console.log(`   - Audits with costs: ${auditsWithValidCosts.length}`);
      
      if (auditsWithValidCosts.length > 0) {
        const totalCost = auditsWithValidCosts.reduce(
          (sum, a) => sum + Number(a.api_costs[0].total_cost), 
          0
        );
        console.log(`   - Total costs: $${totalCost.toFixed(4)}`);
      }
    }

    console.log('\n🧪 Test 4: Checking RLS status...');
    const { data: tables, error: rlsError } = await supabase
      .rpc('check_rls_status');

    if (rlsError) {
      console.log('   ⚠️  Cannot check RLS status (this is okay)');
      console.log('   Run this SQL in Supabase to check manually:');
      console.log('   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = \'api_costs\';');
    }

  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

// Ejecutar tests
testConnection()
  .then(() => {
    console.log('\n✅ All tests completed!');
    console.log('\n📝 Next steps:');
    console.log('   1. If Test 2 failed: Run fix_rls_definitivo.sql');
    console.log('   2. If Test 3 shows empty api_costs: Run the SQL fix');
    console.log('   3. After fixing, restart backend: npm start');
    console.log('   4. Hard refresh frontend: Ctrl+Shift+R');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });