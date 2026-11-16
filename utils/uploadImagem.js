const supabase = require('../config/supabase');
const crypto = require('crypto');
const multer = require('multer');

const BUCKET = String(process.env.SUPABASE_BUCKET || 'imagens').trim();

const TIPOS_PERMITIDOS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!TIPOS_PERMITIDOS[file.mimetype]) {
            return cb(new Error('Envie uma imagem JPG, PNG, WebP ou GIF.'));
        }
        cb(null, true);
    }
});

let bucketCheck = null;

function ensureBucketIsPublic() {
    if (!bucketCheck) {
        bucketCheck = supabase.storage.getBucket(BUCKET).then(({ data, error }) => {
            if (error) {
                bucketCheck = null;
                if (/not found|does not exist/i.test(error.message || '')) {
                    throw new Error('O bucket "' + BUCKET + '" não existe no Supabase. Crie um bucket público com esse nome.');
                }
                if (/fetch failed|ENOTFOUND|getaddrinfo/i.test(error.message || '')) {
                    throw new Error('Não foi possível conectar ao Supabase. Confira se SUPABASE_URL é a Project URL correta (https://SEU-PROJETO.supabase.co) e se o projeto está ativo.');
                }
                if (/invalid api key|jwt|unauthorized|401|403/i.test(error.message || '')) {
                    throw new Error('A chave do Supabase foi recusada. Confira se SUPABASE_SECRET_KEY é a secret key do mesmo projeto.');
                }
                console.warn('Não foi possível verificar o bucket do Supabase:', error.message);
                return;
            }
            if (!data || !data.public) {
                bucketCheck = null;
                throw new Error('O bucket "' + BUCKET + '" não é público. Ative a opção "Public bucket" no Supabase para as fotos aparecerem no site.');
            }
        });
    }
    return bucketCheck;
}

async function uploadImagem(arquivo, pasta) {
    if (!arquivo) return null;

    if (!supabase) {
        throw new Error('Armazenamento de imagens não configurado. Defina SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente.');
    }

    await ensureBucketIsPublic();

    const extensao = TIPOS_PERMITIDOS[arquivo.mimetype];
    if (!extensao) {
        throw new Error('Formato de imagem não permitido.');
    }

    const nomeArquivo = `${crypto.randomUUID()}.${extensao}`;
    const caminho = `${pasta}/${nomeArquivo}`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(caminho, arquivo.buffer, {
            contentType: arquivo.mimetype,
            upsert: false
        });

    if (error) {
        console.error('Falha ao enviar imagem para o Supabase:', error.message);
        if (/bucket/i.test(error.message || '')) {
            throw new Error('O bucket "' + BUCKET + '" não existe no Supabase. Crie um bucket público com esse nome.');
        }
        if (/fetch failed|ENOTFOUND|getaddrinfo/i.test(error.message || '')) {
            throw new Error('Não foi possível conectar ao Supabase. Confira se SUPABASE_URL é a Project URL correta (https://SEU-PROJETO.supabase.co) e se o projeto está ativo.');
        }
        if (/invalid api key|jwt|unauthorized|401|403/i.test(error.message || '')) {
            throw new Error('A chave do Supabase foi recusada. Confira se SUPABASE_SECRET_KEY é a secret key do mesmo projeto.');
        }
        throw new Error('Não foi possível enviar a imagem para o Supabase: ' + error.message);
    }

    const { data } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(caminho);

    return data.publicUrl;
}

module.exports = uploadImagem;
module.exports.upload = upload;
module.exports.BUCKET = BUCKET;
