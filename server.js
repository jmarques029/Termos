require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { usuarios, termos, configuracoes } = require('./database/db');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'assdoc-secret-2024-jwt';

// ─── CONFIGURAÇÃO DE EMAIL (SMTP) ────────────────────────────────────
const smtpConfigurado = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  && process.env.SMTP_USER !== 'seuemail@gmail.com');

const transporter = smtpConfigurado ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }
}) : null;

// Garante que o diretório de uploads existe
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'fotos');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configuração do multer para upload de fotos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  }
});

// Middlewares
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware de autenticação JWT
function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// ─── AUTENTICAÇÃO ─────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });

    const usuario = await usuarios.findOne({ email });
    if (!usuario) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const senhaOk = bcrypt.compareSync(senha, usuario.senha_hash);
    if (!senhaOk) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: usuario._id, nome: usuario.nome, email: usuario.email, role: usuario.role || 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, usuario: { nome: usuario.nome, email: usuario.email, role: usuario.role || 'admin' } });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// GET /api/auth/me — dados do usuário atual (completos do NeDB)
app.get('/api/auth/me', autenticar, async (req, res) => {
  try {
    const usuario = await usuarios.findOne({ _id: req.usuario.id });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const { senha_hash, ...dados } = usuario;
    res.json({ usuario: dados });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao obter dados do usuário' });
  }
});

// PUT /api/usuarios/me/senha — alterar a própria senha do usuário logado
app.put('/api/usuarios/me/senha', autenticar, async (req, res) => {
  try {
    const { senha_atual, senha_nova } = req.body;
    if (!senha_atual || !senha_nova) {
      return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias' });
    }
    if (senha_nova.length < 6) {
      return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 6 caracteres' });
    }

    const usuario = await usuarios.findOne({ _id: req.usuario.id });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // Se for usuário Microsoft (não tem senha local hash ou foi criado por microsoft_oauth)
    if (!usuario.senha_hash) {
      return res.status(400).json({ erro: 'Contas conectadas via Microsoft Outlook devem alterar sua senha diretamente no portal da Microsoft.' });
    }

    // Compara senha atual
    const senhaOk = bcrypt.compareSync(senha_atual, usuario.senha_hash);
    if (!senhaOk) {
      return res.status(401).json({ erro: 'A senha atual está incorreta' });
    }

    // Hash da nova senha e atualização
    const novoHash = bcrypt.hashSync(senha_nova, 10);
    await usuarios.update({ _id: req.usuario.id }, { $set: { senha_hash: novoHash } });

    res.json({ mensagem: 'Senha alterada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno ao alterar a senha' });
  }
});

// ─── LOGIN MICROSOFT (OAUTH) ───────────────────────────────────

// GET /api/auth/microsoft — redireciona para login da Microsoft
app.get('/api/auth/microsoft', (req, res) => {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/microsoft/callback`;

  if (!clientId) {
    // Redireciona de volta com erro se não estiver configurado no .env
    return res.redirect('/index.html?error=connection_failed');
  }

  const authUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=query` +
    `&scope=user.read` +
    `&state=assdoc_oauth`;

  res.redirect(authUrl);
});

// GET /api/auth/microsoft/callback — recebe o código do OAuth e valida com o MS Graph
app.get('/api/auth/microsoft/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    console.error('OAuth Error:', error_description || error);
    return res.redirect(`/index.html?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('/index.html?error=missing_code');
  }

  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/microsoft/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect('/index.html?error=connection_failed');
  }

  try {
    // 1. Troca o código de autorização pelo token de acesso
    const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'user.read');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('grant_type', 'authorization_code');

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      console.error('Token Exchange Error:', tokenData.error_description || tokenData.error);
      return res.redirect(`/index.html?error=${encodeURIComponent(tokenData.error || 'invalid_client')}`);
    }

    const accessToken = tokenData.access_token;

    // 2. Busca informações do usuário no Microsoft Graph
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const graphData = await graphRes.json();
    if (!graphRes.ok || graphData.error) {
      console.error('Microsoft Graph Error:', graphData.error?.message || 'graph_error');
      return res.redirect('/index.html?error=graph_error');
    }

    const email = (graphData.mail || graphData.userPrincipalName || '').toLowerCase();
    const nome = graphData.displayName || graphData.givenName || 'Usuário Microsoft';

    if (!email) {
      return res.redirect('/index.html?error=invalid_email');
    }

    // 3. Procura ou cria o usuário na base NeDB
    let usuario = await usuarios.findOne({ email });
    if (!usuario) {
      usuario = await usuarios.insert({
        nome,
        email,
        senha_hash: '', // Senha local vazia (login exclusivo MS)
        criado_por: 'microsoft_oauth',
        criado_por_nome: 'Microsoft Outlook',
        criado_em: new Date().toISOString()
      });
    }

    // 4. Gera JWT do AssDoc
    const token = jwt.sign(
      { id: usuario._id, nome: usuario.nome, email: usuario.email, role: usuario.role || 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // 5. Envia página HTML rápida para injetar localStorage e redirecionar ao dashboard
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Conectando...</title></head>
      <body style="margin: 0; background: #121214;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; text-align:center; padding:100px 20px; color:#e1e1e6; height:100vh; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;">
          <h2 style="margin: 0; font-size: 24px;">Autenticado com sucesso!</h2>
          <p style="margin: 0; color: #a1a1a6;">Redirecionando para o painel...</p>
        </div>
        <script>
          localStorage.setItem('assdoc_token', '${token}');
          localStorage.setItem('assdoc_usuario', JSON.stringify({ nome: '${usuario.nome.replace(/'/g, "\\'")}', email: '${usuario.email}' }));
          window.location.href = '/dashboard.html';
        </script>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('OAuth Callback Connection Error:', err);
    res.redirect('/index.html?error=connection_failed');
  }
});

// ─── TERMOS ───────────────────────────────────────────────────

// GET /api/departamentos — listar departamentos disponíveis (do banco)
app.get('/api/departamentos', autenticar, async (req, res) => {
  try {
    const cfg = await configuracoes.findOne({ chave: 'departamentos' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar departamentos' });
  }
});

// GET /api/empresas — listar empresas disponíveis para preenchimento automático
app.get('/api/empresas', autenticar, async (req, res) => {
  try {
    const cfg = await configuracoes.findOne({ chave: 'empresas' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar empresas' });
  }
});

// GET /api/cidades — listar cidades disponíveis
app.get('/api/cidades', autenticar, async (req, res) => {
  try {
    const cfg = await configuracoes.findOne({ chave: 'cidades' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar cidades' });
  }
});

// ─── CONFIGURAÇÕES (admin) ─────────────────────────────────────

// Helper para verificar se é admin
function soAdmin(req, res) {
  if (req.usuario.role === 'supervisor') {
    res.status(403).json({ erro: 'Acesso negado. Apenas administradores podem gerenciar configurações.' });
    return false;
  }
  return true;
}

// --- EMPRESAS ---

// GET /api/config/empresas
app.get('/api/config/empresas', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const cfg = await configuracoes.findOne({ chave: 'empresas' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar empresas' });
  }
});

// POST /api/config/empresas
app.post('/api/config/empresas', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const { nome, razao_social, cnpj, endereco, bairro, cidade, uf, cep } = req.body;
    if (!nome || !razao_social || !cnpj) {
      return res.status(400).json({ erro: 'Nome, Razão Social e CNPJ são obrigatórios' });
    }
    const cfg = await configuracoes.findOne({ chave: 'empresas' });
    const nova = {
      id: Date.now().toString(36),
      nome, razao_social, cnpj,
      endereco: endereco || '',
      bairro: bairro || '',
      cidade: cidade || '',
      uf: uf || '',
      cep: cep || ''
    };
    const novaLista = cfg ? [...cfg.dados, nova] : [nova];
    await configuracoes.update({ chave: 'empresas' }, { $set: { dados: novaLista } }, { upsert: true });
    res.status(201).json(nova);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao adicionar empresa' });
  }
});

// PUT /api/config/empresas/:id
app.put('/api/config/empresas/:id', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const cfg = await configuracoes.findOne({ chave: 'empresas' });
    if (!cfg) return res.status(404).json({ erro: 'Nenhuma empresa cadastrada' });
    const novaLista = cfg.dados.map(e => e.id === req.params.id ? { ...e, ...req.body, id: e.id } : e);
    await configuracoes.update({ chave: 'empresas' }, { $set: { dados: novaLista } });
    res.json({ mensagem: 'Empresa atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar empresa' });
  }
});

// DELETE /api/config/empresas/:id
app.delete('/api/config/empresas/:id', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const cfg = await configuracoes.findOne({ chave: 'empresas' });
    if (!cfg) return res.status(404).json({ erro: 'Nenhuma empresa cadastrada' });
    const novaLista = cfg.dados.filter(e => e.id !== req.params.id);
    await configuracoes.update({ chave: 'empresas' }, { $set: { dados: novaLista } });
    res.json({ mensagem: 'Empresa removida com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover empresa' });
  }
});

// --- DEPARTAMENTOS ---

// GET /api/config/departamentos
app.get('/api/config/departamentos', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const cfg = await configuracoes.findOne({ chave: 'departamentos' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar departamentos' });
  }
});

// POST /api/config/departamentos
app.post('/api/config/departamentos', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const { nome } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome do departamento é obrigatório' });
    const cfg = await configuracoes.findOne({ chave: 'departamentos' });
    const lista = cfg ? cfg.dados : [];
    if (lista.map(d => d.toLowerCase()).includes(nome.trim().toLowerCase())) {
      return res.status(409).json({ erro: 'Departamento já cadastrado' });
    }
    const novaLista = [...lista, nome.trim()];
    await configuracoes.update({ chave: 'departamentos' }, { $set: { dados: novaLista } }, { upsert: true });
    res.status(201).json({ nome: nome.trim() });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao adicionar departamento' });
  }
});

// DELETE /api/config/departamentos/:nome
app.delete('/api/config/departamentos/:nome', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const nomeParam = decodeURIComponent(req.params.nome);
    const cfg = await configuracoes.findOne({ chave: 'departamentos' });
    if (!cfg) return res.status(404).json({ erro: 'Nenhum departamento cadastrado' });
    const novaLista = cfg.dados.filter(d => d !== nomeParam);
    await configuracoes.update({ chave: 'departamentos' }, { $set: { dados: novaLista } });
    res.json({ mensagem: 'Departamento removido com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover departamento' });
  }
});

// --- CIDADES ---

// GET /api/config/cidades
app.get('/api/config/cidades', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const cfg = await configuracoes.findOne({ chave: 'cidades' });
    res.json(cfg ? cfg.dados : []);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar cidades' });
  }
});

// POST /api/config/cidades
app.post('/api/config/cidades', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const { nome } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome da cidade é obrigatório' });
    const cfg = await configuracoes.findOne({ chave: 'cidades' });
    const lista = cfg ? cfg.dados : [];
    if (lista.map(c => c.toLowerCase()).includes(nome.trim().toLowerCase())) {
      return res.status(409).json({ erro: 'Cidade já cadastrada' });
    }
    const novaLista = [...lista, nome.trim()].sort();
    await configuracoes.update({ chave: 'cidades' }, { $set: { dados: novaLista } }, { upsert: true });
    res.status(201).json({ nome: nome.trim() });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao adicionar cidade' });
  }
});

// DELETE /api/config/cidades/:nome
app.delete('/api/config/cidades/:nome', autenticar, async (req, res) => {
  if (!soAdmin(req, res)) return;
  try {
    const nomeParam = decodeURIComponent(req.params.nome);
    const cfg = await configuracoes.findOne({ chave: 'cidades' });
    if (!cfg) return res.status(404).json({ erro: 'Nenhuma cidade cadastrada' });
    const novaLista = cfg.dados.filter(c => c !== nomeParam);
    await configuracoes.update({ chave: 'cidades' }, { $set: { dados: novaLista } });
    res.json({ mensagem: 'Cidade removida com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover cidade' });
  }
});

// GET /api/termos — listar todos os termos (somente admin)
app.get('/api/termos', autenticar, async (req, res) => {
  if (req.usuario.role === 'supervisor') {
    return res.status(403).json({ erro: 'Acesso negado. Use /api/termos/supervisor' });
  }
  try {
    const todos = await termos.find({}).sort({ criado_em: -1 });
    res.json(todos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar termos' });
  }
});

// GET /api/termos/supervisor — termos filtrados por departamentos do supervisor
app.get('/api/termos/supervisor', autenticar, async (req, res) => {
  try {
    const usuario = await usuarios.findOne({ _id: req.usuario.id });
    if (!usuario || usuario.role !== 'supervisor') {
      return res.status(403).json({ erro: 'Acesso negado. Rota exclusiva para supervisores.' });
    }
    const deps = usuario.departamentos_permitidos || [];
    if (deps.length === 0) {
      return res.json([]);
    }
    const todos = await termos.find({ departamento: { $in: deps } }).sort({ criado_em: -1 });
    res.json(todos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar termos do supervisor' });
  }
});

// POST /api/termos — criar novo termo
app.post('/api/termos', autenticar, upload.single('foto'), async (req, res) => {
  try {
    const {
      tipo, colaborador_nome, colaborador_matricula,
      cargo, departamento, cidade,
      empresa_id, empresa_nome, empresa_razao_social, empresa_cnpj,
      empresa_endereco, empresa_bairro, empresa_cidade, empresa_uf, empresa_cep,
      equipamento_marca, equipamento_modelo,
      equipamento_serie_imei, numero_patrimonio, numero_ti,
      data_entrega, data_devolucao_prevista
    } = req.body;

    if (!tipo || !colaborador_nome || !cidade || !equipamento_marca || !equipamento_modelo) {
      return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    }

    if (!['celular', 'tablet', 'notebook'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo de equipamento inválido' });
    }

    // Valida cidade dinamicamente no banco
    const cfgCidades = await configuracoes.findOne({ chave: 'cidades' });
    const cidadesPermitidas = cfgCidades ? cfgCidades.dados : [];
    if (cidadesPermitidas.length > 0 && !cidadesPermitidas.includes(cidade)) {
      return res.status(400).json({ erro: `Cidade inválida. Escolha uma das cidades cadastradas: ${cidadesPermitidas.join(', ')}.` });
    }

    const token_unico = uuidv4();
    const foto_path = req.file ? `/uploads/fotos/${req.file.filename}` : null;

    const termo = await termos.insert({
      token_unico,
      tipo,
      status: 'pendente',
      colaborador_nome,
      colaborador_matricula: colaborador_matricula || '',
      cargo: cargo || '',
      departamento: departamento || '',
      cidade,
      empresa_id: empresa_id || '',
      empresa_nome: empresa_nome || '',
      empresa_razao_social: empresa_razao_social || '',
      empresa_cnpj: empresa_cnpj || '',
      empresa_endereco: empresa_endereco || '',
      empresa_bairro: empresa_bairro || '',
      empresa_cidade: empresa_cidade || cidade,
      empresa_uf: empresa_uf || '',
      empresa_cep: empresa_cep || '',
      equipamento_marca,
      equipamento_modelo,
      equipamento_serie_imei: equipamento_serie_imei || '',
      numero_patrimonio: numero_patrimonio || '',
      numero_ti: numero_ti || '',
      data_entrega: data_entrega || '',
      data_devolucao_prevista: data_devolucao_prevista || '',
      foto_path,
      assinatura_base64: null,
      assinado_em: null,
      assinado_ip: null,
      criado_por: req.usuario.id,
      criado_por_nome: req.usuario.nome,
      criado_em: new Date().toISOString()
    });

    const linkAssinatura = `${req.protocol}://${req.get('host')}/assinar.html?token=${token_unico}`;

    res.status(201).json({ termo, linkAssinatura });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar termo' });
  }
});

// GET /api/termos/:id — detalhes de um termo
app.get('/api/termos/:id', autenticar, async (req, res) => {
  try {
    const termo = await termos.findOne({ _id: req.params.id });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado' });

    // Supervisor só pode ver termos do próprio departamento
    if (req.usuario.role === 'supervisor') {
      const usuario = await usuarios.findOne({ _id: req.usuario.id });
      const deps = (usuario && usuario.departamentos_permitidos) || [];
      if (!deps.includes(termo.departamento)) {
        return res.status(403).json({ erro: 'Acesso negado. Este termo não pertence ao seu departamento.' });
      }
    }

    res.json(termo);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar termo' });
  }
});

// DELETE /api/termos/:id
app.delete('/api/termos/:id', autenticar, async (req, res) => {
  try {
    const termo = await termos.findOne({ _id: req.params.id });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado' });

    // Remove foto se existir
    if (termo.foto_path) {
      const fotoAbsoluta = path.join(__dirname, termo.foto_path);
      if (fs.existsSync(fotoAbsoluta)) fs.unlinkSync(fotoAbsoluta);
    }

    await termos.remove({ _id: req.params.id });
    res.json({ mensagem: 'Termo removido com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover termo' });
  }
});

// ─── ASSINATURA (pública — via token) ─────────────────────────

// GET /api/assinar/:token — busca dados do termo pelo token
app.get('/api/assinar/:token', async (req, res) => {
  try {
    const termo = await termos.findOne({ token_unico: req.params.token });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado ou link inválido' });
    if (termo.status === 'assinado') {
      return res.json({ ...termo, ja_assinado: true });
    }
    // Remove assinatura dos dados enviados ao colaborador
    const { assinatura_base64, ...dadosPublicos } = termo;
    res.json({ ...dadosPublicos, ja_assinado: false });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar termo' });
  }
});

// POST /api/assinar/:token — envia assinatura
app.post('/api/assinar/:token', async (req, res) => {
  try {
    const { assinatura_base64, nome_confirmacao } = req.body;
    if (!assinatura_base64 || !nome_confirmacao) {
      return res.status(400).json({ erro: 'Assinatura e nome são obrigatórios' });
    }

    const termo = await termos.findOne({ token_unico: req.params.token });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado' });
    if (termo.status === 'assinado') {
      return res.status(400).json({ erro: 'Este termo já foi assinado' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    await termos.update(
      { token_unico: req.params.token },
      {
        $set: {
          status: 'assinado',
          assinatura_base64,
          nome_confirmacao,
          assinado_em: new Date().toISOString(),
          assinado_ip: ip
        }
      }
    );

    res.json({ mensagem: 'Termo assinado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar assinatura' });
  }
});

// ─── USUÁRIOS (admin) ──────────────────────────────────────────

// GET /api/usuarios — listar todos os admins
app.get('/api/usuarios', autenticar, async (req, res) => {
  try {
    const todos = await usuarios.find({}).sort({ criado_em: 1 });
    // Remove senha_hash da resposta
    const lista = todos.map(({ senha_hash, ...u }) => u);
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar usuários' });
  }
});

// POST /api/usuarios — criar novo admin ou supervisor
app.post('/api/usuarios', autenticar, async (req, res) => {
  // Somente admins podem criar usuários
  if (req.usuario.role === 'supervisor') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  try {
    const { nome, email, senha, role, departamentos_permitidos } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres' });
    }
    const roleValido = ['admin', 'supervisor'].includes(role) ? role : 'admin';

    const existente = await usuarios.findOne({ email });
    if (existente) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail' });

    const senha_hash = bcrypt.hashSync(senha, 10);
    const novo = await usuarios.insert({
      nome,
      email,
      senha_hash,
      role: roleValido,
      departamentos_permitidos: roleValido === 'supervisor' ? (departamentos_permitidos || []) : [],
      criado_por: req.usuario.id,
      criado_por_nome: req.usuario.nome,
      criado_em: new Date().toISOString()
    });

    const { senha_hash: _, ...novoSemSenha } = novo;
    res.status(201).json(novoSemSenha);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar usuário' });
  }
});

// PUT /api/usuarios/:id — atualizar nome ou senha
app.put('/api/usuarios/:id', autenticar, async (req, res) => {
  if (req.usuario.role === 'supervisor') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  try {
    const { nome, senha } = req.body;
    const usuario = await usuarios.findOne({ _id: req.params.id });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const updates = {};
    if (nome) updates.nome = nome;
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres' });
      updates.senha_hash = bcrypt.hashSync(senha, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
    }

    await usuarios.update({ _id: req.params.id }, { $set: updates });
    res.json({ mensagem: 'Usuário atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar usuário' });
  }
});

// PUT /api/usuarios/:id/departamentos — atualizar departamentos permitidos de um supervisor (somente admin)
app.put('/api/usuarios/:id/departamentos', autenticar, async (req, res) => {
  if (req.usuario.role === 'supervisor') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  try {
    const { departamentos_permitidos } = req.body;
    if (!Array.isArray(departamentos_permitidos)) {
      return res.status(400).json({ erro: 'departamentos_permitidos deve ser um array' });
    }
    const usuario = await usuarios.findOne({ _id: req.params.id });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (usuario.role !== 'supervisor') {
      return res.status(400).json({ erro: 'Este usuário não é um supervisor' });
    }
    await usuarios.update({ _id: req.params.id }, { $set: { departamentos_permitidos } });
    res.json({ mensagem: 'Departamentos atualizados com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar departamentos' });
  }
});

// DELETE /api/usuarios/:id — excluir admin ou supervisor
app.delete('/api/usuarios/:id', autenticar, async (req, res) => {
  if (req.usuario.role === 'supervisor') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  try {
    // Não pode excluir a si mesmo
    if (req.params.id === req.usuario.id) {
      return res.status(400).json({ erro: 'Você não pode excluir sua própria conta' });
    }

    const usuario = await usuarios.findOne({ _id: req.params.id });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // Não pode excluir o último admin
    const total = await usuarios.count({});
    if (total <= 1) {
      return res.status(400).json({ erro: 'Não é possível excluir o único administrador do sistema' });
    }

    await usuarios.remove({ _id: req.params.id });
    res.json({ mensagem: 'Usuário excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir usuário' });
  }
});

// ─── DEVOLUÇÃO ────────────────────────────────────────────────────────

// Configuração do multer para fotos de devolução
const DEVOLUCAO_DIR = path.join(__dirname, 'uploads', 'devolucao');
if (!fs.existsSync(DEVOLUCAO_DIR)) {
  fs.mkdirSync(DEVOLUCAO_DIR, { recursive: true });
}
const storageDevolucao = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DEVOLUCAO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `dev_${uuidv4()}${ext}`);
  }
});
const uploadDevolucao = multer({
  storage: storageDevolucao,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por foto
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  }
});

// POST /api/termos/:id/devolucao — registrar devolução (com até 4 fotos)
app.post('/api/termos/:id/devolucao', autenticar, uploadDevolucao.array('fotos_devolucao', 4), async (req, res) => {
  try {
    const termo = await termos.findOne({ _id: req.params.id });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado' });
    if (termo.status !== 'assinado') {
      return res.status(400).json({ erro: 'Só é possível registrar devolução de termos já assinados' });
    }

    // Apenas administradores podem registrar devolução de equipamentos
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso negado. Apenas administradores podem registrar a devolução de equipamentos.' });
    }

    const { devolvido, data_devolucao_real, observacao_devolucao } = req.body;

    // Novas fotos enviadas nesta requisição
    const novasfotos = (req.files || []).map(f => `/uploads/devolucao/${f.filename}`);

    // Mescla com fotos existentes (mantém as antigas, adiciona as novas)
    const fotosExistentes = termo.fotos_devolucao || [];
    const todasFotos = [...fotosExistentes, ...novasfotos].slice(0, 4); // máximo 4

    const updates = {
      devolvido: devolvido === 'true' || devolvido === true,
      data_devolucao_real: data_devolucao_real || null,
      observacao_devolucao: observacao_devolucao || '',
      fotos_devolucao: todasFotos,
      devolucao_registrada_por: req.usuario.nome,
      devolucao_registrada_em: new Date().toISOString()
    };

    await termos.update({ _id: req.params.id }, { $set: updates });
    const termoAtualizado = await termos.findOne({ _id: req.params.id });
    res.json({ mensagem: 'Devolução registrada com sucesso!', termo: termoAtualizado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar devolução' });
  }
});

// DELETE /api/termos/:id/devolucao/foto/:index — remover uma foto de devolução pelo índice
app.delete('/api/termos/:id/devolucao/foto/:index', autenticar, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso negado. Apenas administradores podem remover fotos de devolução.' });
    }
    const termo = await termos.findOne({ _id: req.params.id });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado' });

    const idx = parseInt(req.params.index, 10);
    const fotos = termo.fotos_devolucao || [];
    if (isNaN(idx) || idx < 0 || idx >= fotos.length) {
      return res.status(400).json({ erro: 'Índice de foto inválido' });
    }

    // Remove o arquivo do disco
    const fotoPath = path.join(__dirname, fotos[idx]);
    if (fs.existsSync(fotoPath)) fs.unlinkSync(fotoPath);

    // Remove do array
    const novasFotos = fotos.filter((_, i) => i !== idx);
    await termos.update({ _id: req.params.id }, { $set: { fotos_devolucao: novasFotos } });

    res.json({ mensagem: 'Foto removida com sucesso', fotos_devolucao: novasFotos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover foto de devolução' });
  }
});

// ─── ROTAS DE EMAIL ──────────────────────────────────────────────────

// GET /api/email/status — verifica se SMTP está configurado
app.get('/api/email/status', autenticar, (req, res) => {
  res.json({ configurado: smtpConfigurado });
});

// POST /api/termos/:id/enviar-email — envia link de assinatura por email
app.post('/api/termos/:id/enviar-email', autenticar, async (req, res) => {
  if (!smtpConfigurado) {
    return res.status(503).json({ erro: 'Servidor de e-mail não configurado. Preencha as variáveis SMTP no .env e reinicie.' });
  }

  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'E-mail do destinatário não informado.' });

  try {
    const termo = await termos.findOne({ _id: req.params.id });
    if (!termo) return res.status(404).json({ erro: 'Termo não encontrado.' });

    const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
    const linkAssinatura = `${BASE_URL}/assinar.html?token=${termo.token_assinatura}`;

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1E2D45;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1D3461,#0e2340);padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#00D4FF;letter-spacing:-1px;">TermoEP</div>
          <div style="color:#8aa8c8;font-size:13px;margin-top:4px;">Sistema de Termos de Compromisso</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="color:#eef4fb;font-size:16px;margin:0 0 8px;">Olá, <strong>${termo.colaborador_nome}</strong>!</p>
          <p style="color:#8aa8c8;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Você recebeu um <strong style="color:#eef4fb;">Termo de Compromisso de Equipamento</strong> para assinar digitalmente.
            Clique no botão abaixo para visualizar e assinar o documento.
          </p>
          <!-- Detalhes -->
          <table width="100%" cellpadding="12" style="background:#253550;border-radius:10px;margin-bottom:24px;">
            <tr>
              <td style="color:#8aa8c8;font-size:12px;border-bottom:1px solid rgba(0,212,255,0.1);">Equipamento</td>
              <td style="color:#eef4fb;font-size:13px;font-weight:600;border-bottom:1px solid rgba(0,212,255,0.1);">${termo.equipamento_marca} ${termo.equipamento_modelo}</td>
            </tr>
            <tr>
              <td style="color:#8aa8c8;font-size:12px;border-bottom:1px solid rgba(0,212,255,0.1);">Tipo</td>
              <td style="color:#eef4fb;font-size:13px;font-weight:600;border-bottom:1px solid rgba(0,212,255,0.1);">${termo.tipo.charAt(0).toUpperCase() + termo.tipo.slice(1)}</td>
            </tr>
            <tr>
              <td style="color:#8aa8c8;font-size:12px;">Série / IMEI</td>
              <td style="color:#eef4fb;font-size:13px;font-weight:600;">${termo.equipamento_serie_imei || '—'}</td>
            </tr>
          </table>
          <!-- Botão -->
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${linkAssinatura}" style="display:inline-block;background:#00D4FF;color:#09111d;font-weight:800;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">
              ✍️ Assinar o Documento Agora
            </a>
          </div>
          <!-- Link fallback -->
          <p style="color:#4d6e90;font-size:12px;text-align:center;margin:0;">
            Se o botão não funcionar, copie e cole o link abaixo no navegador:<br>
            <a href="${linkAssinatura}" style="color:#00D4FF;word-break:break-all;">${linkAssinatura}</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 40px;border-top:1px solid rgba(0,212,255,0.1);text-align:center;">
          <p style="color:#4d6e90;font-size:11px;margin:0;">TermoEP — Sistema de Termos de Compromisso · Grupo EP</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `TermoEP <${process.env.SMTP_USER}>`,
      to: email,
      subject: `✍️ Assine o Termo de Compromisso — ${termo.equipamento_marca} ${termo.equipamento_modelo}`,
      html
    });

    // Salva o email no registro do termo
    await termos.update({ _id: req.params.id }, { $set: { colaborador_email: email } });

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    res.status(500).json({ erro: `Falha ao enviar e-mail: ${err.message}` });
  }
});

// Rotas de páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/criar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'criar.html')));
app.get('/assinar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assinar.html')));
app.get('/cidades', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cidades.html')));
app.get('/visualizar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'visualizar.html')));
app.get('/usuarios', (req, res) => res.sendFile(path.join(__dirname, 'public', 'usuarios.html')));
app.get('/conta', (req, res) => res.sendFile(path.join(__dirname, 'public', 'conta.html')));
app.get('/supervisor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'supervisor.html')));
app.get('/configuracoes', (req, res) => res.sendFile(path.join(__dirname, 'public', 'configuracoes.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 Sistema AssDoc rodando em http://localhost:${PORT}`);
  console.log(`   Login: admin@empresa.com | Senha: admin123\n`);
});
