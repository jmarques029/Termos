require('dotenv').config();
const Datastore = require('nedb-promises');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Usa DB_PATH do .env se definido; caso contrário usa a pasta local database/
const DB_DIR = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const usuarios = Datastore.create({ filename: path.join(DB_DIR, 'usuarios.db'), autoload: true });
const termos = Datastore.create({ filename: path.join(DB_DIR, 'termos.db'), autoload: true });
const configuracoes = Datastore.create({ filename: path.join(DB_DIR, 'configuracoes.db'), autoload: true });

// Índices únicos
usuarios.ensureIndex({ fieldName: 'email', unique: true });
termos.ensureIndex({ fieldName: 'token_unico', unique: true });
configuracoes.ensureIndex({ fieldName: 'chave', unique: true });

// Cria admin padrão e dados iniciais se não existirem
async function inicializar() {
  try {
    const admin = await usuarios.findOne({ email: 'admin@empresa.com' });
    if (!admin) {
      const senhaHash = bcrypt.hashSync('admin123', 10);
      await usuarios.insert({
        nome: 'Administrador',
        email: 'admin@empresa.com',
        senha_hash: senhaHash,
        criado_em: new Date().toISOString()
      });
      console.log('✅ Admin padrão criado: admin@empresa.com / admin123');
    }

    // Seed configurações iniciais (apenas se ainda não existirem)
    const cfgEmpresas = await configuracoes.findOne({ chave: 'empresas' });
    if (!cfgEmpresas) {
      await configuracoes.insert({
        chave: 'empresas',
        dados: [
          {
            id: 'campinas',
            nome: 'EPTV Campinas (Matriz)',
            razao_social: 'Empresa Paulista de Televisão S/A',
            cnpj: '46.242.004/0001-87',
            endereco: 'Rua Regina Nogueira, 120',
            bairro: 'Jardim São Gabriel',
            cidade: 'Campinas',
            uf: 'SP',
            cep: '13045-900'
          },
          {
            id: 'ribeirao_preto',
            nome: 'EPTV Ribeirão Preto',
            razao_social: 'Empresa Paulista de Televisão S/A',
            cnpj: '46.242.004/0002-68',
            endereco: 'Rua Javari, 3099',
            bairro: 'Ipiranga',
            cidade: 'Ribeirão Preto',
            uf: 'SP',
            cep: '14060-640'
          },
          {
            id: 'sao_carlos',
            nome: 'EPTV Central (São Carlos)',
            razao_social: 'Empresa Paulista de Televisão S/A',
            cnpj: '57.368.516/0001-22',
            endereco: 'Rua Mário Luchesi, 45',
            bairro: 'Vila Lutfalla',
            cidade: 'São Carlos',
            uf: 'SP',
            cep: '13570-380'
          },
          {
            id: 'varginha',
            nome: 'EPTV Sul de Minas (Varginha)',
            razao_social: 'Televisão Sul de Minas S/A',
            cnpj: '25.166.281/0001-88',
            endereco: 'Rua Professora Helena Reis, 81',
            bairro: 'Centro',
            cidade: 'Varginha',
            uf: 'MG',
            cep: '37006-030'
          }
        ]
      });
      console.log('✅ Empresas padrão inseridas no banco de dados.');
    }

    const cfgDeps = await configuracoes.findOne({ chave: 'departamentos' });
    if (!cfgDeps) {
      await configuracoes.insert({
        chave: 'departamentos',
        dados: [
          'Jornalismo', 'Comercial', 'TI', 'Engenharia', 'Produção',
          'Administrativo', 'Financeiro', 'RH', 'Marketing', 'Operações',
          'Diretoria', 'Tecnologia'
        ]
      });
      console.log('✅ Departamentos padrão inseridos no banco de dados.');
    }

    const cfgCidades = await configuracoes.findOne({ chave: 'cidades' });
    if (!cfgCidades) {
      await configuracoes.insert({
        chave: 'cidades',
        dados: ['Campinas', 'Ribeirão Preto', 'São Carlos', 'Varginha']
      });
      console.log('✅ Cidades padrão inseridas no banco de dados.');
    }

  } catch (err) {
    console.error('Erro ao inicializar banco:', err);
  }
}

inicializar();

module.exports = { usuarios, termos, configuracoes };
