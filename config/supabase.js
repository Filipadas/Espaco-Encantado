require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Aceita tanto o nome novo (SUPABASE_SECRET_KEY) quanto o nome usado pelo
// painel antigo do Supabase (SUPABASE_SERVICE_ROLE_KEY).
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// Não cria o cliente quando faltam as variáveis: assim o site continua no ar
// e o erro aparece de forma clara apenas quando alguém tenta enviar uma foto.
let supabase = null;

if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    } catch (error) {
        console.error('Configuração do Supabase inválida:', error.message);
    }
}

if (supabase) {
    console.log('Supabase configurado em', supabaseUrl, '| bucket:', process.env.SUPABASE_BUCKET || 'imagens');
} else {
    console.warn('Supabase não configurado: defina SUPABASE_URL e SUPABASE_SECRET_KEY para enviar imagens.');
}

module.exports = supabase;
