// backend/scripts/create-user.ts

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { supabaseAdmin } from '../src/config/supabase.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const prompt = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function createUser() {
  console.log('\n🔐 Crear nuevo usuario\n');

  const email = await prompt('Email: ');
  const password = await prompt('Contraseña: ');
  const fullName = await prompt('Nombre completo: ');
  const roleInput = await prompt('Rol (user/admin) [user]: ');
  const role = roleInput || 'user';

  try {
    // Crear usuario en auth.users con service role key
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar email
      user_metadata: {
        full_name: fullName
      }
    });

    if (authError) {
      throw authError;
    }

    console.log(`\n✅ Usuario creado exitosamente!`);
    console.log(`📧 Email: ${email}`);
    console.log(`👤 ID: ${authData.user.id}`);
    console.log(`👔 Rol: ${role}`);
    console.log(`\n✨ El usuario puede iniciar sesión en: http://localhost:5173/login\n`);

  } catch (error: any) {
    console.error('\n❌ Error al crear usuario:', error.message);
  } finally {
    rl.close();
  }
}

createUser();