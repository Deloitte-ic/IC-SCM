// GET /api/data - 读取共享数据（从 GitHub API 实时读取，无 CDN 缓存）
// POST /api/data - 写入共享数据（通过 GitHub API）
//
// 请求中的 token 参数来自前端 localStorage 中的用户个人访问令牌
// 后续可改为 Vercel 环境变量，完全对前端透明

const GITHUB_API = 'https://api.github.com/repos/Deloitte-ic/IC-SCM/contents/shared-data.json';
const GITHUB_RAW = 'https://raw.githubusercontent.com/Deloitte-ic/IC-SCM/gh-pages/shared-data.json';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GitHub-Token');
}

async function fetchGitHub(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 从请求中获取 token：Header > Query > Body
  const token = req.headers['x-github-token'] 
    || req.query.token 
    || (req.body && req.body.token);

  if (!token) {
    return res.status(401).json({ error: '缺少 GitHub Token，请在请求中提供' });
  }

  const authHeaders = { 'Authorization': `token ${token}` };

  try {
    if (req.method === 'GET') {
      // 从 GitHub API 实时读取（绕过 CDN 缓存）
      const data = await fetchGitHub(GITHUB_API, { headers: authHeaders });
      // content 是 base64 编码的
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const json = JSON.parse(content);
      
      res.status(200).json({ 
        success: true, 
        sha: data.sha,
        data: json 
      });
      
    } else if (req.method === 'POST') {
      const { data, sha } = req.body || {};
      if (!data) {
        return res.status(400).json({ error: '缺少 data 字段' });
      }
      
      // 先获取当前文件的 SHA
      let currentSha = sha;
      if (!currentSha) {
        try {
          const meta = await fetchGitHub(GITHUB_API, { headers: authHeaders });
          currentSha = meta.sha;
        } catch (e) {
          // 文件还不存在，SHA 为空
        }
      }
      
      // 写入 GitHub
      const payload = {
        message: 'IC-SCM Vercel API: update shared data',
        content: Buffer.from(JSON.stringify(data)).toString('base64'),
      };
      if (currentSha) payload.sha = currentSha;
      
      await fetchGitHub(GITHUB_API, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      res.status(200).json({ success: true });
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) {
    console.error('API Error:', e);
    res.status(500).json({ error: e.message });
  }
}
