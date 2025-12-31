import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ConfirmDialog } from './ui/confirm-dialog';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check, Github } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

function ApiKeysSettings() {
  const [apiKeys, setApiKeys] = useState([]);
  const [githubTokens, setGithubTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [showNewTokenForm, setShowNewTokenForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newTokenName, setNewTokenName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [showToken, setShowToken] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

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

      // Fetch GitHub tokens
      const githubRes = await authenticatedFetch('/api/settings/credentials?type=github_token');
      const githubData = await githubRes.json();
      setGithubTokens(githubData.credentials || []);
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
    setConfirmDialog({
      isOpen: true,
      title: '删除 API 密钥',
      message: '确定要删除此 API 密钥吗？',
      onConfirm: async () => {
        try {
          await authenticatedFetch(`/api/settings/api-keys/${keyId}`, {
            method: 'DELETE'
          });
          fetchData();
        } catch (error) {
          console.error('Error deleting API key:', error);
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
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

  const createGithubToken = async () => {
    if (!newTokenName.trim() || !newGithubToken.trim()) return;

    try {
      const res = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newTokenName,
          credentialType: 'github_token',
          credentialValue: newGithubToken
        })
      });

      const data = await res.json();
      if (data.success) {
        setNewTokenName('');
        setNewGithubToken('');
        setShowNewTokenForm(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error creating GitHub token:', error);
    }
  };

  const deleteGithubToken = async (tokenId) => {
    setConfirmDialog({
      isOpen: true,
      title: '删除 GitHub 令牌',
      message: '确定要删除此 GitHub 令牌吗？',
      onConfirm: async () => {
        try {
          await authenticatedFetch(`/api/settings/credentials/${tokenId}`, {
            method: 'DELETE'
          });
          fetchData();
        } catch (error) {
          console.error('Error deleting GitHub token:', error);
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const toggleGithubToken = async (tokenId, isActive) => {
    try {
      await authenticatedFetch(`/api/settings/credentials/${tokenId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      fetchData();
    } catch (error) {
      console.error('Error toggling GitHub token:', error);
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
    <>
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="删除"
        cancelText="取消"
        variant="destructive"
      />
      <div className="space-y-8">
      {/* New API Key Alert */}
      {newlyCreatedKey && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <h4 className="font-semibold text-yellow-500 mb-2">⚠️ 保存您的 API 密钥</h4>
          <p className="text-sm text-muted-foreground mb-3">
            这是您唯一一次看到此密钥。请妥善保存。
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
            新建 API 密钥
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          生成 API 密钥以从其他应用程序访问外部 API。
        </p>

        {showNewKeyForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card">
            <Input
              placeholder="API 密钥名称 (例如：生产服务器)"
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
            <p className="text-sm text-muted-foreground italic">尚未创建 API 密钥。</p>
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
                    创建时间: {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used && ` • 最后使用: ${new Date(key.last_used).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={key.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleApiKey(key.id, key.is_active)}
                  >
                    {key.is_active ? '活动' : '未激活'}
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

      {/* GitHub Tokens Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h3 className="text-lg font-semibold">GitHub 令牌</h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewTokenForm(!showNewTokenForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加令牌
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          添加 GitHub 个人访问令牌以通过外部 API 克隆私有仓库。
        </p>

        {showNewTokenForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card">
            <Input
              placeholder="令牌名称 (例如：个人仓库)"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="mb-2"
            />
            <div className="relative">
              <Input
                type={showToken['new'] ? 'text' : 'password'}
                placeholder="GitHub 个人访问令牌 (ghp_...)"
                value={newGithubToken}
                onChange={(e) => setNewGithubToken(e.target.value)}
                className="mb-2 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken({ ...showToken, new: !showToken['new'] })}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showToken['new'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <Button onClick={createGithubToken}>添加令牌</Button>
              <Button variant="outline" onClick={() => {
                setShowNewTokenForm(false);
                setNewTokenName('');
                setNewGithubToken('');
              }}>
                取消
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {githubTokens.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">尚未添加 GitHub 令牌。</p>
          ) : (
            githubTokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{token.credential_name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    添加时间: {new Date(token.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={token.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleGithubToken(token.id, token.is_active)}
                  >
                    {token.is_active ? '活动' : '未激活'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteGithubToken(token.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Documentation Link */}
      <div className="p-4 bg-muted/50 rounded-lg">
        <h4 className="font-semibold mb-2">外部 API 文档</h4>
        <p className="text-sm text-muted-foreground mb-3">
          了解如何使用外部 API 从您的应用程序触发 Claude/Cursor 会话。
        </p>
        <a
          href="/EXTERNAL_API.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          查看 API 文档 →
        </a>
      </div>
    </div>
    </>
  );
}

export default ApiKeysSettings;
