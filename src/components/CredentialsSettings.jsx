import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check, Github, ExternalLink } from 'lucide-react';

import { version } from '../../package.json';
import { authenticatedFetch } from '../utils/api';

function CredentialsSettings() {
  const [apiKeys, setApiKeys] = useState([]);
  const [githubCredentials, setGithubCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [showNewGithubForm, setShowNewGithubForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newGithubName, setNewGithubName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [newGithubDescription, setNewGithubDescription] = useState('');
  const [showToken, setShowToken] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);

  

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch API keys
      const apiKeysRes = await authenticatedFetch('/api/settings/api-keys');
      const apiKeysData = await apiKeysRes.json();
      setApiKeys(apiKeysData.apiKeys || []);

      // Fetch GitHub credentials only
      const credentialsRes = await authenticatedFetch('/api/settings/credentials?type=github_token');
      const credentialsData = await credentialsRes.json();
      setGithubCredentials(credentialsData.credentials || []);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await authenticatedFetch('/api/settings/api-keys', {
        method: 'POST',
        body: JSON.stringify({ keyName: newKeyName })
      });

      const data = await res.json();
      if (data.success) {
        setNewlyCreatedKey(data.apiKey);
        setNewKeyName('');
        setShowNewKeyForm(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error creating API key:', error);
    }
  };

  const deleteApiKey = async (keyId) => {
    if (!confirm('确定要删除此 API 密钥吗?')) return;

    try {
      await authenticatedFetch(`/api/settings/api-keys/${keyId}`, {
        method: 'DELETE'
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting API key:', error);
    }
  };

  const toggleApiKey = async (keyId, isActive) => {
    try {
      await authenticatedFetch(`/api/settings/api-keys/${keyId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      fetchData();
    } catch (error) {
      console.error('Error toggling API key:', error);
    }
  };

  const createGithubCredential = async () => {
    if (!newGithubName.trim() || !newGithubToken.trim()) return;

    try {
      const res = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newGithubName,
          credentialType: 'github_token',
          credentialValue: newGithubToken,
          description: newGithubDescription
        })
      });

      const data = await res.json();
      if (data.success) {
        setNewGithubName('');
        setNewGithubToken('');
        setNewGithubDescription('');
        setShowNewGithubForm(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error creating GitHub credential:', error);
    }
  };

  const deleteGithubCredential = async (credentialId) => {
    if (!confirm('确定要删除此 GitHub 令牌吗?')) return;

    try {
      await authenticatedFetch(`/api/settings/credentials/${credentialId}`, {
        method: 'DELETE'
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting GitHub credential:', error);
    }
  };

  const toggleGithubCredential = async (credentialId, isActive) => {
    try {
      await authenticatedFetch(`/api/settings/credentials/${credentialId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      fetchData();
    } catch (error) {
      console.error('Error toggling GitHub credential:', error);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-8">
      {/* New API Key Alert */}
      {newlyCreatedKey && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <h4 className="font-semibold text-yellow-500 mb-2">⚠️ 保存您的 API 密钥</h4>
          <p className="text-sm text-muted-foreground mb-3">
            这是您唯一一次看到此密钥的机会，请妥善保存。
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-background/50 rounded font-mono text-sm break-all">
              {newlyCreatedKey.apiKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(newlyCreatedKey.apiKey, 'new')}
            >
              {copiedKey === 'new' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => setNewlyCreatedKey(null)}
          >
            我已保存
          </Button>
        </div>
      )}

      {/* API Keys Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <h3 className="text-lg font-semibold">API 密钥</h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewKeyForm(!showNewKeyForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            新建密钥
          </Button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">
            生成 API 密钥以便从其他应用程序访问外部 API。
          </p>
          <a
            href="/api-docs.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            API 文档
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {showNewKeyForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card">
            <Input
              placeholder="API 密钥名称（例如：生产服务器）"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="mb-2"
            />
            <div className="flex gap-2">
              <Button onClick={createApiKey}>创建</Button>
              <Button variant="outline" onClick={() => setShowNewKeyForm(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">尚未创建任何 API 密钥。</p>
          ) : (
            apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{key.key_name}</div>
                  <code className="text-xs text-muted-foreground">{key.api_key}</code>
                  <div className="text-xs text-muted-foreground mt-1">
                    创建于: {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used && ` • 最后使用: ${new Date(key.last_used).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={key.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleApiKey(key.id, key.is_active)}
                  >
                    {key.is_active ? '已启用' : '已禁用'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteApiKey(key.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* GitHub Credentials Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h3 className="text-lg font-semibold">GitHub 凭据</h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewGithubForm(!showNewGithubForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加令牌
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          添加 GitHub 个人访问令牌以克隆私有仓库。您也可以在 API 请求中直接传递令牌而无需存储。
        </p>

        {showNewGithubForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card space-y-3">
            <Input
              placeholder="令牌名称（例如：个人仓库）"
              value={newGithubName}
              onChange={(e) => setNewGithubName(e.target.value)}
            />

            <div className="relative">
              <Input
                type={showToken['new'] ? 'text' : 'password'}
                placeholder="GitHub 个人访问令牌 (ghp_...)"
                value={newGithubToken}
                onChange={(e) => setNewGithubToken(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken({ ...showToken, new: !showToken['new'] })}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showToken['new'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <Input
              placeholder="描述（可选）"
              value={newGithubDescription}
              onChange={(e) => setNewGithubDescription(e.target.value)}
            />

            <div className="flex gap-2">
              <Button onClick={createGithubCredential}>添加令牌</Button>
              <Button variant="outline" onClick={() => {
                setShowNewGithubForm(false);
                setNewGithubName('');
                setNewGithubToken('');
                setNewGithubDescription('');
              }}>
                取消
              </Button>
            </div>

            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline block"
            >
              如何创建 GitHub 个人访问令牌 →
            </a>
          </div>
        )}

        <div className="space-y-2">
          {githubCredentials.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">尚未添加任何 GitHub 令牌。</p>
          ) : (
            githubCredentials.map((credential) => (
              <div
                key={credential.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{credential.credential_name}</div>
                  {credential.description && (
                    <div className="text-xs text-muted-foreground">{credential.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    添加于: {new Date(credential.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={credential.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleGithubCredential(credential.id, credential.is_active)}
                  >
                    {credential.is_active ? '已启用' : '已禁用'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteGithubCredential(credential.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      
    </div>
  );
}

export default CredentialsSettings;
