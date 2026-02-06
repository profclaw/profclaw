import {
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Shield,
  Server,
  Trash2,
  Key,
  Database,
  Zap,
  Eye,
  EyeOff,
  RotateCcw,
  Download,
  Upload,
  Loader2,
  Plug,
  Terminal,
  Cpu,
  Search,
  Settings2,
  ChevronRight,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Github,
  Webhook,
  Copy,
  Check,
  ExternalLink,
  Save,
  Code2,
  FileJson,
  AlertTriangle,
  Unlock,
  Container,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldOff,
  Plus,
  Trash,
  FileCode,
  Globe,
  Activity,
  Clock,
  Timer,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnboardingTour } from "@/components/shared/OnboardingTour";
import { toast } from "sonner";
import {
  api,
  type Settings as SettingsType,
  type PluginHealth,
} from "@/core/api/client";
// Import refactored sections (shared components remain inline for now)
import {
  GeneralSection,
  NotificationsSection,
  AIProvidersSection,
  LabelsSection,
  DevicesSection,
  MemorySection,
  SkillsSection,
  ToolsSection,
  MessagingSection,
} from "../sections";
import { SyncStatus } from "@/features/sync/components/SyncStatus";
import { SETTINGS_SECTIONS, API_BASE, type SectionId } from "../constants";

// Context for tracking unsaved changes across the settings page
interface UnsavedChangesContextType {
  pendingChanges: Partial<SettingsType>;
  setPendingChange: (category: string, key: string, value: unknown) => void;
  clearPendingChanges: () => void;
  hasPendingChanges: boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | null>(
  null
);

function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context)
    throw new Error(
      "useUnsavedChanges must be used within UnsavedChangesProvider"
    );
  return context;
}

export function Settings() {
  const { section } = useParams<{ section?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { resetTour, startTour } = useOnboardingTour();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [pendingChanges, setPendingChanges] = useState<Partial<SettingsType>>(
    {},
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Determine active section
  const activeSection = (section as SectionId) || "general";

  // Check if there are pending changes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  // Set a pending change (doesn't save immediately)
  const setPendingChange = useCallback(
    (category: string, key: string, value: unknown) => {
      setPendingChanges((prev) => ({
        ...prev,
        [category]: {
          ...((prev[category as keyof SettingsType] as Record<
            string,
            unknown
          >) || {}),
          [key]: value,
        },
      }));
    },
    [],
  );

  // Clear all pending changes
  const clearPendingChanges = useCallback(() => {
    setPendingChanges({});
  }, []);

  // Fetch settings from API
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
    staleTime: 30000,
  });

  const settings = settingsData?.settings;

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: (updates: Partial<SettingsType>) =>
      api.settings.update(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings updated");
    },
    onError: (error) => {
      toast.error("Failed to update settings", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Reset settings mutation
  const resetSettings = useMutation({
    mutationFn: () => api.settings.reset(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings reset to defaults");
    },
    onError: (error) => {
      toast.error("Failed to reset settings", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Save all pending changes
  const savePendingChanges = useMutation({
    mutationFn: (changes: Partial<SettingsType>) =>
      api.settings.update(changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      clearPendingChanges();
      toast.success("All changes saved");
    },
    onError: (error) => {
      toast.error("Failed to save changes", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  // Context value for child components
  const unsavedChangesContextValue: UnsavedChangesContextType = {
    pendingChanges,
    setPendingChange,
    clearPendingChanges,
    hasPendingChanges,
  };

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query) {
      setSearchParams({ q: query });
    } else {
      setSearchParams({});
    }
  };

  // Filter sections based on search
  const filteredSections = useMemo(() => {
    if (!searchQuery) return SETTINGS_SECTIONS;
    const q = searchQuery.toLowerCase();
    return SETTINGS_SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleToggle = (
    category: keyof SettingsType,
    key: string,
    currentValue: boolean,
  ) => {
    updateSettings.mutate({
      [category]: { [key]: !currentValue },
    });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(`${API_BASE}/api/tasks/export`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `glinr-tasks-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Tasks exported successfully");
    } catch (error) {
      toast.error("Failed to export tasks");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const content = await file.text();
      const data = JSON.parse(content);

      const response = await fetch(`${API_BASE}/api/tasks/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      toast.success(result.message);
    } catch (error) {
      toast.error("Failed to import tasks", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRestartTour = () => {
    resetTour();
    setTimeout(() => startTour(), 100);
  };

  // Render active section content
  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <GeneralSection
            theme={theme}
            setTheme={setTheme}
            handleRestartTour={handleRestartTour}
          />
        );
      case "account":
        return <AccountSection />;
      case "notifications":
        return (
          <NotificationsSection
            settings={settings}
            handleToggle={handleToggle}
            isPending={updateSettings.isPending}
          />
        );
      case "ai-providers":
        return <AIProvidersSection />;
      case "labels":
        return <LabelsSection />;
      case "devices":
        return <DevicesSection />;
      case "memory":
        return <MemorySection />;
      case "skills":
        return <SkillsSection />;
      case "tools":
        return <ToolsSection />;
      case "integrations":
        return <IntegrationsSection settings={settings} />;
      case "messaging":
        return <MessagingSection />;
      case "security":
        return <SecuritySection />;
      case "plugins":
        return <PluginsSection />;
      case "storage":
        return (
          <StorageSection
            isExporting={isExporting}
            isImporting={isImporting}
            handleExport={handleExport}
            handleImport={handleImport}
            fileInputRef={fileInputRef}
          />
        );
      case "system":
        return (
          <SystemSection
            settings={settings}
            handleToggle={handleToggle}
            updateSettings={updateSettings}
            resetSettings={resetSettings}
          />
        );
      default:
        return (
          <GeneralSection
            theme={theme}
            setTheme={setTheme}
            handleRestartTour={handleRestartTour}
          />
        );
    }
  };

  const currentSection = SETTINGS_SECTIONS.find((s) => s.id === activeSection);

  return (
    <UnsavedChangesContext.Provider value={unsavedChangesContextValue}>
      <div className="flex flex-col lg:flex-row gap-8 xl:gap-12 w-full max-w-7xl mx-auto px-4 lg:px-6 pb-20">
        {/* Left Sidebar Navigation */}
        <aside className="lg:w-72 shrink-0">
          <div className="glass rounded-2xl p-5 sticky top-24">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search settings..."
                aria-label="Search settings"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-muted/40 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Navigation */}
            <nav className="space-y-1.5">
              {filteredSections.map((item) => {
                const isActive = item.id === activeSection;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/settings/${item.id}`)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all",
                      isActive
                        ? "bg-[#0a0a0b] text-white shadow-lg shadow-black/20 nav-item-active z-10"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-white")} />
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm font-medium truncate", isActive && "text-white")}>
                        {item.label}
                      </div>
                      {!isActive && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {item.description}
                        </div>
                      )}
                    </div>
                    {isActive && <ChevronRight className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </nav>

            {/* Quick Actions */}
            <div className="mt-6 pt-4 border-t border-border">
              <span className="nav-group-label mb-2 px-3">
                Quick Actions
              </span>
              <button
                onClick={() => resetSettings.mutate()}
                disabled={resetSettings.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {resetSettings.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Reset All Settings
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 pb-12">
          {/* Section Header */}
          <header className="mb-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
              <span>Settings</span>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">
                {currentSection?.label}
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">
              {currentSection?.label}
            </h2>
            <p className="text-muted-foreground mt-1">
              {currentSection?.description}
            </p>
          </header>

          {/* Section Content */}
          <div className="space-y-8">{renderSectionContent()}</div>
        </main>

        {/* Floating Save Bar */}
        <FloatingSaveBar
          hasPendingChanges={hasPendingChanges}
          pendingChanges={pendingChanges}
          onSave={() => savePendingChanges.mutate(pendingChanges)}
          onDiscard={clearPendingChanges}
          isSaving={savePendingChanges.isPending}
        />
      </div>
    </UnsavedChangesContext.Provider>
  );
}

// Section Components

// Types for profile API response
interface ProfileUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt: string;
  onboardingCompleted: boolean;
}

interface ConnectedAccount {
  provider: string;
  username: string;
  connectedAt: string;
}

interface ProfileResponse {
  user: ProfileUser;
  preferences: Record<string, unknown> | null;
  connectedAccounts: ConnectedAccount[];
  activeSessions: number;
}

function AccountSection() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", bio: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    new: "",
    confirm: "",
  });
  const [emailForm, setEmailForm] = useState({
    newEmail: "",
    currentPassword: "",
  });
  const [copiedId, setCopiedId] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Fetch user profile with all data
  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["user", "profile"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/users/me/profile`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to fetch profile" }));
        throw new Error(err.error || "Failed to fetch profile");
      }
      return res.json() as Promise<ProfileResponse>;
    },
  });

  // Fetch connected accounts with more detail
  const { data: connectedAccountsData } = useQuery({
    queryKey: ["user", "connected-accounts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/users/me/connected-accounts`, {
        credentials: "include",
      });
      if (!res.ok)
        return { accounts: [], hasPassword: false, canDisconnect: false };
      return res.json() as Promise<{
        accounts: ConnectedAccount[];
        hasPassword: boolean;
        canDisconnect: boolean;
      }>;
    },
  });

  // Update profile mutation
  const updateProfile = useMutation({
    mutationFn: async (updates: { name?: string; bio?: string }) => {
      const res = await fetch(`${API_BASE}/api/users/me/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "profile"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      toast.success("Profile updated");
      setIsEditing(false);
    },
    onError: () => toast.error("Failed to update profile"),
  });

  // Change password mutation (PUT method)
  const changePassword = useMutation({
    mutationFn: async (data: {
      currentPassword?: string;
      newPassword: string;
    }) => {
      const res = await fetch(`${API_BASE}/api/users/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to change password" }));
        throw new Error(err.error || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["user", "connected-accounts"],
      });
      toast.success("Password updated successfully");
      setShowPasswordChange(false);
      setPasswordForm({ current: "", new: "", confirm: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Change email mutation
  const changeEmail = useMutation({
    mutationFn: async (data: {
      newEmail: string;
      currentPassword?: string;
    }) => {
      const res = await fetch(`${API_BASE}/api/users/me/email`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to change email" }));
        throw new Error(err.error || "Failed to change email");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "profile"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      toast.success("Email updated successfully");
      setShowEmailChange(false);
      setEmailForm({ newEmail: "", currentPassword: "" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Disconnect OAuth account mutation
  const disconnectAccount = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(
        `${API_BASE}/api/users/me/connected-accounts/${provider}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to disconnect" }));
        throw new Error(err.error || "Failed to disconnect account");
      }
      return res.json();
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ["user", "profile"] });
      queryClient.invalidateQueries({
        queryKey: ["user", "connected-accounts"],
      });
      toast.success(`${provider} account disconnected`);
      setDisconnecting(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDisconnecting(null);
    },
  });

  const handleSave = async () => {
    if (!editForm.name.trim()) return;
    setIsSaving(true);
    await updateProfile.mutateAsync({
      name: editForm.name.trim(),
      bio: editForm.bio.trim(),
    });
    setIsSaving(false);
  };

  const handleEdit = () => {
    setEditForm({
      name: profile?.user?.name || "",
      bio: profile?.user?.bio || "",
    });
    setIsEditing(true);
  };

  const hasPassword = connectedAccountsData?.hasPassword ?? false;
  const canDisconnect = connectedAccountsData?.canDisconnect ?? false;

  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const togglePasswordVisibility = (field: string) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const getPasswordStrength = (
    password: string
  ): { label: string; color: string; width: string; score: number } => {
    if (!password)
      return { label: "", color: "", width: "0%", score: 0 };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1)
      return { label: "Weak", color: "bg-red-500", width: "20%", score };
    if (score === 2)
      return { label: "Fair", color: "bg-orange-500", width: "40%", score };
    if (score === 3)
      return { label: "Good", color: "bg-amber-500", width: "60%", score };
    if (score === 4)
      return { label: "Strong", color: "bg-green-500", width: "80%", score };
    return { label: "Very Strong", color: "bg-emerald-500", width: "100%", score };
  };

  const passwordStrength = getPasswordStrength(passwordForm.new);
  const passwordsMatch =
    passwordForm.confirm.length > 0 && passwordForm.new === passwordForm.confirm;
  const passwordsMismatch =
    passwordForm.confirm.length > 0 && passwordForm.new !== passwordForm.confirm;

  const handlePasswordChange = () => {
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    if (passwordForm.new.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!/[a-zA-Z]/.test(passwordForm.new) || !/\d/.test(passwordForm.new)) {
      toast.error("Password must contain at least 1 letter and 1 number");
      return;
    }
    // If user has password, require current; OAuth-only users don't need current
    const data: { currentPassword?: string; newPassword: string } = {
      newPassword: passwordForm.new,
    };
    if (hasPassword) {
      data.currentPassword = passwordForm.current;
    }
    changePassword.mutate(data);
  };

  const handleEmailChange = () => {
    if (!emailForm.newEmail.trim()) {
      toast.error("Please enter a new email");
      return;
    }
    const data: { newEmail: string; currentPassword?: string } = {
      newEmail: emailForm.newEmail.trim(),
    };
    if (hasPassword) {
      data.currentPassword = emailForm.currentPassword;
    }
    changeEmail.mutate(data);
  };

  const handleDisconnect = (provider: string) => {
    if (!canDisconnect) {
      toast.error(
        "Please set a password before disconnecting your only login method",
      );
      setShowPasswordChange(true);
      return;
    }
    setDisconnecting(provider);
    disconnectAccount.mutate(provider);
  };

  const copyUserId = () => {
    if (profile?.user?.id) {
      navigator.clipboard.writeText(profile.user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
      toast.success("User ID copied");
    }
  };

  const user = profile?.user;
  const connectedAccounts = profile?.connectedAccounts || [];
  const isFallbackEmail = user?.email?.endsWith("@github.local");

  const roleColors: Record<string, string> = {
    admin: "bg-red-500/80 text-white border-red-400/50 backdrop-blur-xl backdrop-saturate-150 shadow-lg shadow-red-500/20",
    user: "bg-black/60 text-white border-white/30 backdrop-blur-xl backdrop-saturate-150 shadow-lg shadow-black/20",
  };

  if (error) {
    return (
      <SettingsCard
        title="Profile"
        description="Manage your account information"
      >
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">
            Failed to load profile data
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-xl"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["user", "profile"] })
            }
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </SettingsCard>
    );
  }

  return (
    <>
      <SettingsCard
        title="Profile"
        description="Manage your account information"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Avatar and Name */}
            <div className="flex items-start gap-4">
              <div className="relative">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="h-20 w-20 rounded-full ring-4 ring-primary/20 object-cover"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary to-primary/60 ring-4 ring-primary/20 flex items-center justify-center text-2xl font-bold text-white">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute -bottom-1 -right-1 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border",
                    roleColors[user?.role || "user"] || roleColors.user,
                  )}
                >
                  {user?.role || "user"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, name: e.target.value }))
                        }
                        className="w-full field"
                        placeholder="Your name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Bio
                      </label>
                      <textarea
                        value={editForm.bio}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, bio: e.target.value }))
                        }
                        className="w-full field resize-none"
                        placeholder="A short bio about yourself"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !editForm.name.trim()}
                        className="rounded-xl"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-1" />
                            Save
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditing(false)}
                        className="rounded-xl"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold">
                        {user?.name || "User"}
                      </h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleEdit}
                        className="h-7 px-2 rounded-lg"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {user?.email || "No email"}
                      </p>
                      {isFallbackEmail && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded-md border border-amber-500/20">
                          Temporary
                        </span>
                      )}
                    </div>
                    {user?.bio && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {user.bio}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Member since{" "}
                      {user?.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Unknown"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Fallback Email Warning */}
            {isFallbackEmail && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Update your email address
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your email is a temporary placeholder. Log out and log back
                    in with GitHub to fetch your real email, or set a custom
                    email below.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 rounded-xl h-7 text-xs"
                    onClick={() => setShowEmailChange(true)}
                  >
                    Set Email Address
                  </Button>
                </div>
              </div>
            )}

            {/* Account Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground mb-1">
                    Email Address
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-xs"
                    onClick={() => setShowEmailChange(true)}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-sm font-medium truncate">
                  {user?.email || "Not set"}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Active Sessions
                </p>
                <p className="text-sm font-medium">
                  {profile?.activeSessions || 1} device
                  {(profile?.activeSessions || 1) > 1 ? "s" : ""}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">
                  Account Status
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      user?.status === "active"
                        ? "bg-green-500"
                        : "bg-amber-500",
                    )}
                  />
                  <p className="text-sm font-medium capitalize">
                    {user?.status || "Active"}
                  </p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">User ID</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono text-muted-foreground truncate flex-1">
                    {user?.id || "Unknown"}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={copyUserId}
                  >
                    {copiedId ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Email Change Card */}
      {showEmailChange && (
        <SettingsCard
          title="Change Email"
          description="Update your email address"
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                New Email Address
              </label>
              <input
                type="email"
                value={emailForm.newEmail}
                onChange={(e) =>
                  setEmailForm((f) => ({ ...f, newEmail: e.target.value }))
                }
                className="w-full field"
                placeholder="your@email.com"
                autoFocus
              />
            </div>
            {hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Current Password
                </label>
                <input
                  type="password"
                  value={emailForm.currentPassword}
                  onChange={(e) =>
                    setEmailForm((f) => ({
                      ...f,
                      currentPassword: e.target.value,
                    }))
                  }
                  className="w-full field"
                  placeholder="Enter your password to confirm"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleEmailChange}
                disabled={changeEmail.isPending || !emailForm.newEmail.trim()}
                className="rounded-xl"
              >
                {changeEmail.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Update Email"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowEmailChange(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Connected Accounts */}
      <SettingsCard
        title="Connected Accounts"
        description="Linked external accounts for authentication"
      >
        <div className="space-y-3">
          {connectedAccounts.length > 0 ? (
            connectedAccounts.map((account) => (
              <div
                key={account.provider}
                className="flex items-center justify-between p-3 rounded-xl bg-muted/30"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#24292f] flex items-center justify-center">
                    <Github className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      @{account.username}
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Connected{" "}
                      {new Date(account.connectedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://github.com/${account.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors p-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDisconnect(account.provider)}
                    disabled={disconnecting === account.provider}
                  >
                    {disconnecting === account.provider ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No connected accounts
            </div>
          )}
          {!canDisconnect && connectedAccounts.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              Set a password before disconnecting your only login method
            </p>
          )}
        </div>
      </SettingsCard>

      {/* Password Section - Always visible */}
      <SettingsCard
        title="Password"
        description={
          hasPassword
            ? "Change your account password"
            : "Set a password to enable email login"
        }
      >
        {showPasswordChange ? (
          <div className="space-y-4">
            {hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.current ? "text" : "password"}
                    value={passwordForm.current}
                    onChange={(e) =>
                      setPasswordForm((f) => ({ ...f, current: e.target.value }))
                    }
                    className="w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility("current")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPasswords.current ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {hasPassword ? "New Password" : "Password"}
              </label>
              <div className="relative">
                <input
                  type={showPasswords.new ? "text" : "password"}
                  value={passwordForm.new}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, new: e.target.value }))
                  }
                  className="w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder={
                    hasPassword
                      ? "Enter new password"
                      : "Create a password (min 8 characters)"
                  }
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility("new")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords.new ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {/* Password Strength Indicator */}
              {passwordForm.new && (
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-300", passwordStrength.color)}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <p className={cn(
                      "text-xs font-medium",
                      passwordStrength.score <= 1 && "text-red-500",
                      passwordStrength.score === 2 && "text-orange-500",
                      passwordStrength.score === 3 && "text-amber-500",
                      passwordStrength.score >= 4 && "text-green-500",
                    )}>
                      {passwordStrength.label}
                    </p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span className={cn(passwordForm.new.length >= 8 ? "text-green-500" : "")}>
                        {passwordForm.new.length >= 8 ? <CheckCircle2 className="h-3 w-3 inline mr-0.5" /> : <XCircle className="h-3 w-3 inline mr-0.5" />}
                        8+ chars
                      </span>
                      <span className={cn(/[a-zA-Z]/.test(passwordForm.new) && /\d/.test(passwordForm.new) ? "text-green-500" : "")}>
                        {/[a-zA-Z]/.test(passwordForm.new) && /\d/.test(passwordForm.new) ? <CheckCircle2 className="h-3 w-3 inline mr-0.5" /> : <XCircle className="h-3 w-3 inline mr-0.5" />}
                        Letter + number
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showPasswords.confirm ? "text" : "password"}
                  value={passwordForm.confirm}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, confirm: e.target.value }))
                  }
                  className={cn(
                    "w-full bg-muted/40 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors",
                    passwordsMatch && "border-green-500/50",
                    passwordsMismatch && "border-red-500/50",
                  )}
                  placeholder="Confirm password"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility("confirm")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords.confirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passwordsMismatch && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Passwords do not match
                </p>
              )}
              {passwordsMatch && (
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Passwords match
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={handlePasswordChange}
                disabled={
                  changePassword.isPending ||
                  !passwordForm.new ||
                  !passwordForm.confirm ||
                  passwordsMismatch ||
                  passwordForm.new.length < 8 ||
                  (hasPassword && !passwordForm.current)
                }
                className="rounded-xl"
              >
                {changePassword.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                {hasPassword ? "Update Password" : "Set Password"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowPasswordChange(false);
                  setPasswordForm({ current: "", new: "", confirm: "" });
                  setShowPasswords({});
                }}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center",
                hasPassword ? "bg-green-500/10" : "bg-amber-500/10"
              )}>
                {hasPassword ? (
                  <Shield className="h-5 w-5 text-green-500" />
                ) : (
                  <Unlock className="h-5 w-5 text-amber-500" />
                )}
              </div>
              <div>
                {hasPassword ? (
                  <>
                    <p className="text-sm font-medium">Password protected</p>
                    <p className="text-xs text-muted-foreground">
                      You can log in with email + password
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-amber-500">No password set</p>
                    <p className="text-xs text-muted-foreground">
                      Set one to enable email login alongside OAuth
                    </p>
                  </>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPasswordChange(true)}
              className="rounded-xl"
            >
              <Key className="h-4 w-4 mr-2" />
              {hasPassword ? "Change" : "Set Password"}
            </Button>
          </div>
        )}

        {/* CLI Reset Hint */}
        {hasPassword && !showPasswordChange && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/20">
              <Terminal className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground/80">Forgot your password?</p>
                <p>Ask an admin to reset it, or run this on the server:</p>
                <code className="block mt-1 px-2 py-1.5 bg-muted/40 rounded-lg font-mono text-[11px] break-all">
                  glinr auth reset-password {profile?.user?.email || "your@email.com"}
                </code>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      <RecoveryCodesSection />

      {/* Support Section */}
      <SettingsCard title="Support" description="Get help with your account">
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div>
              <p className="text-sm font-medium">Contact Support</p>
              <p className="text-xs text-muted-foreground">
                For account issues and questions
              </p>
            </div>
            <a
              href="mailto:support@glincker.com"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              support@glincker.com
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div>
              <p className="text-sm font-medium">Documentation</p>
              <p className="text-xs text-muted-foreground">
                Guides and API reference
              </p>
            </div>
            <a
              href="https://docs.glinr.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              docs.glinr.dev
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {user?.role === "admin" && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Admin Contact
                </p>
                <p className="text-xs text-muted-foreground">
                  System administrator
                </p>
              </div>
              <a
                href="mailto:support@glincker.com"
                className="text-sm text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
              >
                support@glincker.com
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// GeneralSection and NotificationsSection are now imported from "../sections"

function IntegrationsSection({ settings }: { settings?: SettingsType }) {
  return (
    <>
      <SettingsCard
        title="AI Services"
        description="Configure connections to AI providers"
      >
        <div className="space-y-4">
          <ApiInputField
            label="OpenClaw API Key"
            placeholder="sk-oc-••••••••••••••••"
            value={settings?.integrations?.openclawApiKey}
            category="integrations"
            fieldKey="openclawApiKey"
          />
          <ApiInputField
            label="Ollama Endpoint"
            placeholder="http://localhost:11434"
            value={settings?.integrations?.ollamaEndpoint}
            category="integrations"
            fieldKey="ollamaEndpoint"
            isSecret={false}
          />
        </div>
      </SettingsCard>

      <GitHubIntegrationCard settings={settings} />

      <SettingsCard
        title="Sync Status"
        description="Real-time sync status for connected platforms"
      >
        <SyncStatus />
      </SettingsCard>

      <SettingsCard
        title="Project Management"
        description="Connect to issue trackers"
      >
        <div className="space-y-4">
          <ApiInputField
            label="Jira Webhook Secret"
            placeholder="••••••••"
            value={settings?.integrations?.jiraWebhookSecret}
            category="integrations"
            fieldKey="jiraWebhookSecret"
          />
          <ApiInputField
            label="Linear Webhook Secret"
            placeholder="••••••••"
            value={settings?.integrations?.linearWebhookSecret}
            category="integrations"
            fieldKey="linearWebhookSecret"
          />
        </div>
      </SettingsCard>
    </>
  );
}

// GitHub Integration Card with OAuth status and repos
function GitHubIntegrationCard({ settings }: { settings?: SettingsType }) {
  const [showRepos, setShowRepos] = useState(false);

  // Fetch GitHub connection status
  const { data: githubStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["github", "status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/import/github/status`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch GitHub status");
      return res.json() as Promise<{
        connected: boolean;
        username?: string;
        hasToken?: boolean;
      }>;
    },
  });

  // Fetch repos when expanded
  const {
    data: reposData,
    isLoading: isReposLoading,
    refetch: refetchRepos,
  } = useQuery({
    queryKey: ["github", "repos"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/import/github/repos`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch repos");
      return res.json() as Promise<{
        repos: Array<{
          id: string;
          name: string;
          nameWithOwner: string;
          description: string | null;
          isPrivate: boolean;
          url: string;
          stargazerCount: number;
          pushedAt: string | null;
        }>;
        count: number;
      }>;
    },
    enabled: showRepos && githubStatus?.connected,
  });

  const isConnected = githubStatus?.connected;

  return (
    <SettingsCard
      title="GitHub Integration"
      description="Connect your GitHub account for projects, issues, and sync"
    >
      <div className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                isConnected ? "bg-green-500/10" : "bg-muted",
              )}
            >
              <Github
                className={cn(
                  "h-5 w-5",
                  isConnected ? "text-green-500" : "text-muted-foreground",
                )}
              />
            </div>
            <div>
              {isStatusLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isConnected ? (
                <>
                  <p className="font-medium flex items-center gap-2">
                    @{githubStatus?.username}
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Connected via OAuth
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-muted-foreground">
                    Not connected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sign in with GitHub to enable sync
                  </p>
                </>
              )}
            </div>
          </div>
          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRepos(!showRepos)}
              className="rounded-xl"
            >
              {showRepos ? "Hide" : "View"} Repos
              <ChevronRight
                className={cn(
                  "h-4 w-4 ml-1 transition-transform",
                  showRepos && "rotate-90",
                )}
              />
            </Button>
          )}
        </div>

        {/* Repos List */}
        {showRepos && isConnected && (
          <div className="rounded-2xl glass shadow-lg overflow-hidden">
            <div className="p-2 bg-muted/30 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {reposData?.count || 0} repositories
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchRepos()}
                disabled={isReposLoading}
                className="h-7 px-2"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isReposLoading && "animate-spin",
                  )}
                />
              </Button>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {isReposLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : reposData?.repos?.length ? (
                <div className="divide-y">
                  {reposData.repos.slice(0, 20).map((repo) => (
                    <div
                      key={repo.id}
                      className="p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <a
                              href={repo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-sm hover:text-primary truncate flex items-center gap-1"
                            >
                              {repo.nameWithOwner}
                              <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                            {repo.isPrivate && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                                Private
                              </span>
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {repo.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          ⭐ {repo.stargazerCount}
                        </span>
                      </div>
                    </div>
                  ))}
                  {reposData.repos.length > 20 && (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                      +{reposData.repos.length - 20} more repositories
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No repositories found
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual Token (Fallback) */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-2">
            Alternatively, add a personal access token for CLI access:
          </p>
          <ApiInputField
            label="GitHub Personal Token"
            placeholder="ghp_••••••••••••••••"
            value={settings?.integrations?.githubToken}
            category="integrations"
            fieldKey="githubToken"
          />
        </div>
      </div>
    </SettingsCard>
  );
}

// ============================================================================
// Security Section - Tool Execution Security
// ============================================================================

type SecurityMode = "deny" | "sandbox" | "allowlist" | "ask" | "full";

interface SecurityPolicy {
  mode: SecurityMode;
  askTimeout?: number;
  allowlistCount?: number;
  sandboxEnabled?: boolean;
}

interface AllowlistEntry {
  pattern: string;
  type: "command" | "path" | "url";
  description?: string;
  addedAt: string;
}

interface SandboxStatus {
  available: boolean;
  image: string;
  poolSize: number;
  activeContainers: number;
}

interface PoolStatus {
  running: number;
  queued: number;
  maxConcurrent: number;
  maxQueueSize: number;
}

interface RateLimitConfig {
  enabled: boolean;
  userLimit: number;
  conversationLimit: number;
  globalLimit: number;
}

const SECURITY_MODES: {
  mode: SecurityMode;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    mode: "deny",
    label: "Deny All",
    description: "Block all tool execution",
    icon: ShieldOff,
    color: "red",
  },
  {
    mode: "sandbox",
    label: "Sandbox",
    description: "Run in isolated Docker containers",
    icon: Container,
    color: "blue",
  },
  {
    mode: "allowlist",
    label: "Allowlist",
    description: "Only pre-approved commands",
    icon: ShieldCheck,
    color: "green",
  },
  {
    mode: "ask",
    label: "Ask Always",
    description: "Require approval for each tool",
    icon: ShieldQuestion,
    color: "amber",
  },
  {
    mode: "full",
    label: "Full Access",
    description: "No restrictions (dangerous!)",
    icon: Unlock,
    color: "red",
  },
];

function SecuritySection() {
  const queryClient = useQueryClient();
  const [newPattern, setNewPattern] = useState("");
  const [newType, setNewType] = useState<"command" | "path" | "url">("command");
  const [newDescription, setNewDescription] = useState("");

  // Fetch security policy
  const {
    data: securityData,
    refetch: refetchSecurity,
    isRefetching: isRefetchingSecurity,
  } = useQuery({
    queryKey: ["tools", "security"],
    queryFn: async () => {
      const res = await fetch("http://localhost:3000/api/tools/security");
      if (!res.ok) throw new Error("Failed to fetch security policy");
      return res.json() as Promise<{
        policy: SecurityPolicy;
        allowlist: AllowlistEntry[];
      }>;
    },
    refetchInterval: 30000,
  });

  // Fetch execution status
  const {
    data: statusData,
    refetch: refetchStatus,
    isRefetching: isRefetchingStatus,
  } = useQuery({
    queryKey: ["tools", "status"],
    queryFn: async () => {
      const res = await fetch("http://localhost:3000/api/tools/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json() as Promise<{
        sandbox: SandboxStatus;
        pool: PoolStatus;
        rateLimit: RateLimitConfig;
      }>;
    },
    refetchInterval: 10000,
  });

  // Update security policy
  const updatePolicy = useMutation({
    mutationFn: async (updates: {
      mode?: SecurityMode;
      askTimeout?: number;
    }) => {
      const res = await fetch("http://localhost:3000/api/tools/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", "security"] });
      toast.success("Security policy updated");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed"),
  });

  // Add to allowlist
  const addToAllowlist = useMutation({
    mutationFn: async (entry: {
      pattern: string;
      type: string;
      description?: string;
    }) => {
      const res = await fetch(
        "http://localhost:3000/api/tools/security/allowlist",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        },
      );
      if (!res.ok) throw new Error("Failed to add to allowlist");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", "security"] });
      setNewPattern("");
      setNewDescription("");
      toast.success("Added to allowlist");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed"),
  });

  // Remove from allowlist
  const removeFromAllowlist = useMutation({
    mutationFn: async (pattern: string) => {
      const res = await fetch(
        `http://localhost:3000/api/tools/security/allowlist/${encodeURIComponent(pattern)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("Failed to remove from allowlist");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", "security"] });
      toast.success("Removed from allowlist");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed"),
  });

  // Update rate limit
  const updateRateLimit = useMutation({
    mutationFn: async (config: Partial<RateLimitConfig>) => {
      const res = await fetch(
        "http://localhost:3000/api/tools/ratelimit/config",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        },
      );
      if (!res.ok) throw new Error("Failed to update rate limits");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools", "status"] });
      toast.success("Rate limits updated");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const policy = securityData?.policy;
  const allowlist = securityData?.allowlist || [];
  const sandbox = statusData?.sandbox;
  const pool = statusData?.pool;
  const rateLimit = statusData?.rateLimit;

  const getModeColors = (mode: SecurityMode, isActive: boolean) => {
    const config = SECURITY_MODES.find((m) => m.mode === mode);
    const color = config?.color || "gray";
    if (!isActive) return "border-border bg-muted/30 hover:bg-muted/50";
    switch (color) {
      case "red":
        return "border-red-500/50 bg-red-500/10 ring-2 ring-red-500/30";
      case "blue":
        return "border-blue-500/50 bg-blue-500/10 ring-2 ring-blue-500/30";
      case "green":
        return "border-green-500/50 bg-green-500/10 ring-2 ring-green-500/30";
      case "amber":
        return "border-amber-500/50 bg-amber-500/10 ring-2 ring-amber-500/30";
      default:
        return "border-primary/50 bg-primary/10 ring-2 ring-primary/30";
    }
  };

  const getModeIconColor = (mode: SecurityMode) => {
    const config = SECURITY_MODES.find((m) => m.mode === mode);
    switch (config?.color) {
      case "red":
        return "text-red-500";
      case "blue":
        return "text-blue-500";
      case "green":
        return "text-green-500";
      case "amber":
        return "text-amber-500";
      default:
        return "text-muted-foreground";
    }
  };

  const handleAddToAllowlist = () => {
    if (!newPattern.trim()) {
      toast.error("Pattern is required");
      return;
    }
    addToAllowlist.mutate({
      pattern: newPattern.trim(),
      type: newType,
      description: newDescription.trim() || undefined,
    });
  };

  return (
    <>
      {/* Security Mode Selector */}
      <SettingsCard
        title="Security Mode"
        description="Control how tool commands are validated and executed"
      >
        <div className="space-y-4">
          {/* Current Status Banner */}
          <div
            className={cn(
              "flex items-center gap-4 p-4 rounded-xl border",
              policy?.mode === "full" || policy?.mode === "deny"
                ? "bg-red-500/5 border-red-500/20"
                : "bg-green-500/5 border-green-500/20",
            )}
          >
            <div
              className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center",
                policy?.mode === "full" || policy?.mode === "deny"
                  ? "bg-red-500/10"
                  : "bg-green-500/10",
              )}
            >
              <Shield
                className={cn(
                  "h-6 w-6",
                  policy?.mode === "full" || policy?.mode === "deny"
                    ? "text-red-500"
                    : "text-green-500",
                )}
              />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold">
                Current Mode:{" "}
                {SECURITY_MODES.find((m) => m.mode === policy?.mode)?.label ||
                  "Unknown"}
              </h4>
              <p className="text-sm text-muted-foreground">
                {
                  SECURITY_MODES.find((m) => m.mode === policy?.mode)
                    ?.description
                }
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchSecurity()}
              disabled={isRefetchingSecurity}
              className="rounded-xl"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-2",
                  isRefetchingSecurity && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>

          {/* Mode Options */}
          <div className="grid gap-3">
            {SECURITY_MODES.map((config) => {
              const isActive = policy?.mode === config.mode;
              const Icon = config.icon;
              return (
                <button
                  key={config.mode}
                  onClick={() => updatePolicy.mutate({ mode: config.mode })}
                  disabled={updatePolicy.isPending}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all text-left",
                    getModeColors(config.mode, isActive),
                  )}
                >
                  <div
                    className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center",
                      isActive ? "bg-white/10" : "bg-muted/50",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        isActive
                          ? getModeIconColor(config.mode)
                          : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{config.label}</h4>
                      {isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          Active
                        </span>
                      )}
                      {config.mode === "full" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                          Dangerous
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {config.description}
                    </p>
                  </div>
                  {isActive && (
                    <CheckCircle2
                      className={cn("h-5 w-5", getModeIconColor(config.mode))}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Ask Mode Timeout */}
          {policy?.mode === "ask" && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border">
              <div>
                <p className="text-sm font-medium">Approval Timeout</p>
                <p className="text-xs text-muted-foreground">
                  How long to wait for user approval
                </p>
              </div>
              <select
                value={policy?.askTimeout || 30000}
                onChange={(e) =>
                  updatePolicy.mutate({ askTimeout: parseInt(e.target.value) })
                }
                className="field py-1.5"
              >
                <option value={15000}>15 seconds</option>
                <option value={30000}>30 seconds</option>
                <option value={60000}>1 minute</option>
                <option value={120000}>2 minutes</option>
                <option value={300000}>5 minutes</option>
              </select>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Allowlist Management */}
      <SettingsCard
        title="Allowlist"
        description="Pre-approved patterns for commands, paths, and URLs"
      >
        <div className="space-y-4">
          {/* Add New Entry */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Add New Pattern</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(e.target.value as "command" | "path" | "url")
                }
                className="field"
              >
                <option value="command">Command</option>
                <option value="path">File Path</option>
                <option value="url">URL</option>
              </select>
              <input
                type="text"
                placeholder={
                  newType === "command"
                    ? "git *"
                    : newType === "path"
                      ? "/workspace/**"
                      : "https://api.*"
                }
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                className="col-span-2 field"
              />
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="flex-1 field"
              />
              <Button
                onClick={handleAddToAllowlist}
                disabled={addToAllowlist.isPending || !newPattern.trim()}
                className="rounded-xl"
              >
                {addToAllowlist.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Allowlist Entries */}
          {allowlist.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No patterns in allowlist</p>
              <p className="text-xs">
                Add patterns to allow specific commands, paths, or URLs
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allowlist.map((entry, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border group"
                >
                  <div
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold",
                      entry.type === "command"
                        ? "bg-indigo-500/10 text-indigo-500"
                        : entry.type === "path"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-green-500/10 text-green-500",
                    )}
                  >
                    {entry.type === "command" ? (
                      <Terminal className="h-4 w-4" />
                    ) : entry.type === "path" ? (
                      <FileCode className="h-4 w-4" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <code className="text-sm font-mono">{entry.pattern}</code>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {entry.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFromAllowlist.mutate(entry.pattern)}
                    disabled={removeFromAllowlist.isPending}
                    className="opacity-0 group-hover:opacity-100 h-8 w-8 p-0 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Execution Status */}
      <SettingsCard
        title="Execution Status"
        description="Real-time tool execution monitoring"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sandbox Status */}
          <div
            className={cn(
              "p-4 rounded-xl border",
              sandbox?.available
                ? "bg-green-500/5 border-green-500/20"
                : "bg-muted/30 border-border",
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Container
                className={cn(
                  "h-4 w-4",
                  sandbox?.available
                    ? "text-green-500"
                    : "text-muted-foreground",
                )}
              />
              <span className="text-xs font-medium">Sandbox</span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold",
                sandbox?.available ? "text-green-500" : "text-muted-foreground",
              )}
            >
              {sandbox?.available ? "Ready" : "Unavailable"}
            </p>
            {sandbox?.available ? (
              <p className="text-xs text-muted-foreground mt-1">
                {sandbox.activeContainers}/{sandbox.poolSize} containers
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Docker required
              </p>
            )}
          </div>

          {/* Running Tasks */}
          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-medium">Running</span>
            </div>
            <p className="text-2xl font-bold text-blue-500">
              {pool?.running || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              of {pool?.maxConcurrent || 10} max
            </p>
          </div>

          {/* Queued Tasks */}
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium">Queued</span>
            </div>
            <p className="text-2xl font-bold text-amber-500">
              {pool?.queued || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              of {pool?.maxQueueSize || 100} max
            </p>
          </div>

          {/* Rate Limits */}
          <div
            className={cn(
              "p-4 rounded-xl border",
              rateLimit?.enabled
                ? "bg-indigo-500/5 border-indigo-500/20"
                : "bg-muted/30 border-border",
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Timer className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-medium">Rate Limit</span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold",
                rateLimit?.enabled
                  ? "text-indigo-500"
                  : "text-muted-foreground",
              )}
            >
              {rateLimit?.enabled ? "Active" : "Disabled"}
            </p>
            {rateLimit?.enabled && (
              <p className="text-xs text-muted-foreground mt-1">
                {rateLimit.globalLimit}/min global
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchStatus()}
            disabled={isRefetchingStatus}
            className="rounded-xl"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4 mr-2",
                isRefetchingStatus && "animate-spin",
              )}
            />
            Refresh Status
          </Button>
        </div>
      </SettingsCard>

      {/* Rate Limit Configuration */}
      <SettingsCard
        title="Rate Limits"
        description="Configure execution rate limits to prevent abuse"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Enable Rate Limiting"
            description="Enforce limits on tool execution frequency"
            checked={rateLimit?.enabled ?? true}
            onChange={() =>
              updateRateLimit.mutate({ enabled: !rateLimit?.enabled })
            }
            disabled={updateRateLimit.isPending}
          />

          {rateLimit?.enabled && (
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Per User
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.userLimit || 100}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        userLimit: parseInt(e.target.value) || 100,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={1000}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Per Conversation
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.conversationLimit || 50}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        conversationLimit: parseInt(e.target.value) || 50,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={500}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Global Limit
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={rateLimit?.globalLimit || 500}
                    onChange={(e) =>
                      updateRateLimit.mutate({
                        globalLimit: parseInt(e.target.value) || 500,
                      })
                    }
                    className="w-full field"
                    min={1}
                    max={5000}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    /min
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Security Info */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h4 className="font-semibold mb-1">Security Best Practices</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                • Use <strong>Sandbox</strong> mode for production environments
                to isolate tool execution
              </li>
              <li>
                • Configure the <strong>Allowlist</strong> to restrict which
                commands can run without approval
              </li>
              <li>
                • Enable <strong>Rate Limiting</strong> to prevent abuse and
                runaway processes
              </li>
              <li>
                • Avoid <strong>Full Access</strong> mode unless absolutely
                necessary for development
              </li>
              <li>
                • Regularly review the <strong>Audit Log</strong> for suspicious
                activity
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

// Recovery Codes Section
function RecoveryCodesSection() {
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [codesConfirmed, setCodesConfirmed] = useState(false);

  // Fetch recovery codes count
  const { data: codesData, refetch: refetchCodes } = useQuery({
    queryKey: ["user", "recovery-codes-count"],
    queryFn: async () => {
      const res = await fetch("/api/users/me/recovery-codes/count", {
        credentials: "include",
      });
      if (!res.ok) return { remainingCodes: 0, hasRecoveryCodes: false };
      return res.json() as Promise<{
        remainingCodes: number;
        hasRecoveryCodes: boolean;
      }>;
    },
  });

  // Regenerate recovery codes
  const regenerateCodes = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users/me/recovery-codes/regenerate", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to regenerate codes");
      return res.json() as Promise<{
        success: boolean;
        recoveryCodes: string[];
        message: string;
      }>;
    },
    onSuccess: (data) => {
      setNewCodes(data.recoveryCodes);
      refetchCodes();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to regenerate codes",
      ),
  });

  const handleRegenerate = () => {
    regenerateCodes.mutate();
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(newCodes.join("\n"));
    toast.success("Recovery codes copied to clipboard");
  };

  // Download helper - creates and triggers file download
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  const handleDownloadTxt = () => {
    const content = [
      "GLINR Recovery Codes",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Keep these codes in a safe place. Each code can only be used once.",
      "",
      ...newCodes.map((code, i) => `${i + 1}. ${code}`),
    ].join("\n");
    downloadFile(content, "glinr-recovery-codes.txt", "text/plain");
  };

  const handleDownloadJson = () => {
    const content = JSON.stringify(
      {
        app: "GLINR",
        type: "recovery_codes",
        generatedAt: new Date().toISOString(),
        codes: newCodes,
        warning: "Each code can only be used once. Keep these secure.",
      },
      null,
      2
    );
    downloadFile(content, "glinr-recovery-codes.json", "application/json");
  };

  const handleDownloadCsv = () => {
    const content = [
      "index,code,status",
      ...newCodes.map((code, i) => `${i + 1},${code},unused`),
    ].join("\n");
    downloadFile(content, "glinr-recovery-codes.csv", "text/csv");
  };

  const handleCloseDialog = (forceClose = false) => {
    if (!forceClose && newCodes.length > 0 && !codesConfirmed) {
      toast.error("Please confirm you have saved your recovery codes");
      return;
    }
    setShowRegenerateDialog(false);
    setNewCodes([]);
    setCodesConfirmed(false);
  };

  return (
    <>
      <SettingsCard
        title="Recovery Codes"
        description="Backup codes for account recovery if you lose access"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Key className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="font-medium">Recovery Codes</p>
                <p className="text-sm text-muted-foreground">
                  {codesData?.hasRecoveryCodes
                    ? `${codesData.remainingCodes} codes remaining`
                    : "No recovery codes configured"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRegenerateDialog(true)}
              className="rounded-xl"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Recovery codes can be used to regain access to your account if you
            forget your password. Each code can only be used once. Keep them in
            a safe place.
          </p>
        </div>
      </SettingsCard>

      {/* Regenerate Dialog - Using proper Dialog component with portal */}
      <Dialog
        open={showRegenerateDialog}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog(newCodes.length === 0);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Key className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <DialogTitle>Recovery Codes</DialogTitle>
                <DialogDescription>
                  {newCodes.length > 0
                    ? "Save these codes securely"
                    : "Generate new backup codes"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {newCodes.length === 0 ? (
            <>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-500">Warning</p>
                    <p className="text-muted-foreground">
                      Regenerating codes will invalidate all existing recovery
                      codes. Make sure you save the new codes in a secure
                      location.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowRegenerateDialog(false)}
                  className="flex-1 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRegenerate}
                  disabled={regenerateCodes.isPending}
                  className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {regenerateCodes.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Generate New Codes
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-muted/40 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {newCodes.map((code, i) => (
                    <div
                      key={i}
                      className="bg-background rounded-lg px-3 py-2 text-center"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyAll}
                  className="flex-1 rounded-xl"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy All
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="rounded-xl">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleDownloadTxt}>
                      <FileCode className="h-4 w-4 mr-2" />
                      Text (.txt)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadJson}>
                      <FileJson className="h-4 w-4 mr-2" />
                      JSON (.json)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadCsv}>
                      <Database className="h-4 w-4 mr-2" />
                      CSV (.csv)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={codesConfirmed}
                  onChange={(e) => setCodesConfirmed(e.target.checked)}
                  className="mt-1 rounded"
                />
                <span className="text-sm text-muted-foreground">
                  I have saved these recovery codes in a secure location. I
                  understand they will not be shown again.
                </span>
              </label>

              <Button
                onClick={() => handleCloseDialog()}
                disabled={!codesConfirmed}
                className="w-full rounded-xl"
              >
                Done
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// AI Provider configuration moved to ../constants.ts
// AIProvidersSection moved to ../sections/AIProvidersSection.tsx

function PluginsSection() {
  const queryClient = useQueryClient();

  // Fetch plugin health
  const {
    data: healthData,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["plugins", "health"],
    queryFn: () => api.plugins.health(),
    refetchInterval: 30000, // Refresh every 30s
  });

  // Toggle plugin mutation
  const togglePlugin = useMutation({
    mutationFn: ({
      pluginId,
      enabled,
    }: {
      pluginId: string;
      enabled: boolean;
    }) => api.plugins.toggle(pluginId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Plugin updated");
    },
    onError: (error) => {
      toast.error("Failed to update plugin", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const plugins = healthData?.plugins || [];

  const getStatusColor = (status: PluginHealth["status"]) => {
    switch (status) {
      case "online":
        return {
          bg: "bg-green-500/10",
          text: "text-green-500",
          border: "border-green-500/20",
        };
      case "offline":
        return {
          bg: "bg-yellow-500/10",
          text: "text-yellow-500",
          border: "border-yellow-500/20",
        };
      case "error":
        return {
          bg: "bg-red-500/10",
          text: "text-red-500",
          border: "border-red-500/20",
        };
      case "disabled":
        return {
          bg: "bg-muted/50",
          text: "text-muted-foreground",
          border: "border-border",
        };
    }
  };

  const getStatusIcon = (status: PluginHealth["status"]) => {
    switch (status) {
      case "online":
        return <CheckCircle2 className="h-4 w-4" />;
      case "offline":
        return <AlertCircle className="h-4 w-4" />;
      case "error":
        return <XCircle className="h-4 w-4" />;
      case "disabled":
        return <XCircle className="h-4 w-4" />;
    }
  };

  const getPluginIcon = (id: string) => {
    if (id.includes("mcp")) return <Terminal className="h-5 w-5" />;
    if (id.includes("cli")) return <Cpu className="h-5 w-5" />;
    if (id.includes("ollama")) return <Zap className="h-5 w-5" />;
    if (id.includes("github")) return <Github className="h-5 w-5" />;
    if (id.includes("webhook")) return <Webhook className="h-5 w-5" />;
    return <Plug className="h-5 w-5" />;
  };

  // Group plugins
  const corePlugins = plugins.filter((p) =>
    ["mcp-server", "cli-access", "ollama"].includes(p.id),
  );
  const webhookPlugins = plugins.filter((p) => p.id.startsWith("webhook-"));

  return (
    <>
      {/* Refresh Button */}
      <div className="flex justify-end mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="rounded-xl"
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", isRefetching && "animate-spin")}
          />
          Refresh Status
        </Button>
      </div>

      {/* Core Plugins */}
      <SettingsCard
        title="Core Plugins"
        description="Essential GLINR extensions"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {corePlugins.map((plugin) => {
              const colors = getStatusColor(plugin.status);
              return (
                <div
                  key={plugin.id}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl border",
                    colors.border,
                    colors.bg,
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-xl flex items-center justify-center",
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {getPluginIcon(plugin.id)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{plugin.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={cn(
                            "flex items-center gap-1 text-xs",
                            colors.text,
                          )}
                        >
                          {getStatusIcon(plugin.status)}
                          {plugin.status.toUpperCase()}
                        </span>
                        {plugin.message && (
                          <span className="text-xs text-muted-foreground">
                            • {plugin.message}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(checked) =>
                      togglePlugin.mutate({
                        pluginId: plugin.id,
                        enabled: checked,
                      })
                    }
                    disabled={togglePlugin.isPending}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      {/* Webhook Integrations */}
      <SettingsCard
        title="Webhook Receivers"
        description="Receive events from external services"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {webhookPlugins.map((plugin) => {
              const colors = getStatusColor(plugin.status);
              return (
                <div
                  key={plugin.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl border",
                    colors.border,
                    colors.bg,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(colors.text)}>
                      {getPluginIcon(plugin.id)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {plugin.name.replace(" Webhook", "")}
                      </p>
                      <span className={cn("text-xs", colors.text)}>
                        {plugin.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={(checked) =>
                      togglePlugin.mutate({
                        pluginId: plugin.id,
                        enabled: checked,
                      })
                    }
                    disabled={togglePlugin.isPending}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      {/* CLI Quick Reference */}
      <SettingsCard
        title="CLI & MCP Commands"
        description="Control GLINR from your terminal"
      >
        {/* Terminal Window */}
        <div className="rounded-xl overflow-hidden border border-border">
          {/* Terminal Header */}
          <div className="bg-muted/80 px-4 py-2 flex items-center gap-2 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-muted-foreground ml-2 font-mono">
              Terminal
            </span>
          </div>

          {/* Terminal Content */}
          <div className="bg-zinc-950 dark:bg-zinc-900 p-4 space-y-4">
            {/* Task Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Task Management
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="glinr task list"
                  description="List all tasks"
                />
                <CommandLine
                  command="glinr task create"
                  description="Create a new task"
                />
                <CommandLine
                  command="glinr task get <id>"
                  description="Get task details"
                />
              </div>
            </div>

            {/* Config Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Configuration
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="glinr config get"
                  description="View settings"
                />
                <CommandLine
                  command="glinr config set --key value"
                  description="Update settings"
                />
              </div>
            </div>

            {/* Server Commands */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Server & MCP
              </p>
              <div className="space-y-1">
                <CommandLine
                  command="glinr serve --port 3000"
                  description="Start API server"
                />
                <CommandLine
                  command="npx glinr-mcp"
                  description="Run MCP server for AI agents"
                  highlight
                />
              </div>
            </div>
          </div>
        </div>

        {/* Installation Hint */}
        <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
          <Terminal className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Install CLI Globally</p>
            <p className="text-xs text-muted-foreground">
              npm install -g @glincker/task-manager
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-xs"
            onClick={() =>
              window.open(
                "https://github.com/GLINCKER/glinr-task-manager",
                "_blank",
              )
            }
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Docs
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}

function StorageSection({
  isExporting,
  isImporting,
  handleExport,
  handleImport,
  fileInputRef,
}: any) {
  return (
    <>
      <SettingsCard title="Database" description="Local storage configuration">
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
          <div>
            <p className="text-sm font-medium">Local SQLite</p>
            <p className="text-xs text-muted-foreground">/data/glinr.db</p>
          </div>
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-500/10 text-green-500">
            CONNECTED
          </span>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Backup & Restore"
        description="Export or import your data"
      >
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 rounded-xl"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export Tasks
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex-1 rounded-xl"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Import Tasks
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Cloud Sync" description="Sync data across devices">
        <Button variant="outline" className="w-full rounded-xl" disabled>
          <Server className="h-4 w-4 mr-2" />
          Connect to Turso Cloud (Coming Soon)
        </Button>
      </SettingsCard>
    </>
  );
}

function SystemSection({
  settings,
  handleToggle,
  updateSettings,
  resetSettings,
}: any) {
  return (
    <>
      <SettingsCard
        title="Execution"
        description="Control how agents run tasks"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Autonomous Execution"
            description="Allow agents to run tasks without manual approval"
            checked={settings?.system?.autonomousExecution ?? false}
            onChange={() =>
              handleToggle(
                "system",
                "autonomousExecution",
                settings?.system?.autonomousExecution ?? false,
              )
            }
            disabled={updateSettings.isPending}
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Max Concurrent Tasks</p>
              <p className="text-xs text-muted-foreground">
                Limit parallel task execution
              </p>
            </div>
            <select
              value={settings?.system?.maxConcurrentTasks ?? 3}
              onChange={(e) =>
                updateSettings.mutate({
                  system: { maxConcurrentTasks: parseInt(e.target.value) },
                })
              }
              className="field py-1.5"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Privacy & Telemetry"
        description="Control data collection"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Usage Telemetry"
            description="Help improve GLINR with anonymous usage data"
            checked={settings?.system?.telemetry ?? true}
            onChange={() =>
              handleToggle(
                "system",
                "telemetry",
                settings?.system?.telemetry ?? true,
              )
            }
            disabled={updateSettings.isPending}
          />
          <ToggleOption
            label="Debug Mode"
            description="Enable verbose logging for troubleshooting"
            checked={settings?.system?.debugMode ?? false}
            onChange={() =>
              handleToggle(
                "system",
                "debugMode",
                settings?.system?.debugMode ?? false,
              )
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Authentication"
        description="Login and registration security options"
      >
        <div className="space-y-4">
          <ToggleOption
            label="Show Forgot Password"
            description="Display the 'Forgot password?' link on the login page with CLI reset instructions"
            checked={settings?.system?.showForgotPassword ?? true}
            onChange={() =>
              handleToggle(
                "system",
                "showForgotPassword",
                settings?.system?.showForgotPassword ?? true,
              )
            }
            disabled={updateSettings.isPending}
          />
        </div>
      </SettingsCard>

      {/* Raw JSON Override */}
      <SettingsCard
        title="Advanced Configuration"
        description="Edit settings as raw JSON"
      >
        <JsonOverrideEditor
          settings={settings}
          onSave={(updates) => updateSettings.mutate(updates)}
          isSaving={updateSettings.isPending}
        />
      </SettingsCard>

      <div className="glass rounded-2xl p-6 border border-red-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-400">Danger Zone</h3>
            <p className="text-xs text-muted-foreground">
              Permanent actions that cannot be undone
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="rounded-xl border-red-500/20 text-red-400 hover:bg-red-500/10"
          >
            Clear Task History
          </Button>
          <Button
            variant="outline"
            className="rounded-xl border-red-500/20 text-red-400 hover:bg-red-500/10"
            onClick={() => resetSettings.mutate()}
            disabled={resetSettings.isPending}
          >
            {resetSettings.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Reset All Settings
          </Button>
        </div>
      </div>
    </>
  );
}

// Shared Components

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-6 lg:p-8">
      <div className="mb-4">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ApiInputField({
  label,
  placeholder,
  value,
  category,
  fieldKey,
  isSecret = true,
}: {
  label: string;
  placeholder: string;
  value?: string;
  category: string;
  fieldKey: string;
  isSecret?: boolean;
}) {
  const { setPendingChange, pendingChanges } = useUnsavedChanges();
  const [showValue, setShowValue] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");

  // Get pending value if exists
  const pendingValue = (
    pendingChanges[category as keyof SettingsType] as Record<string, unknown>
  )?.[fieldKey] as string | undefined;
  const displayValue = pendingValue !== undefined ? pendingValue : localValue;
  const isDirty = displayValue !== (value || "");

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    // Track change in context for floating save bar
    if (newValue !== (value || "")) {
      setPendingChange(category, fieldKey, newValue);
    }
  };

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={isSecret && !showValue ? "password" : "text"}
            placeholder={placeholder}
            value={displayValue}
            onChange={handleChange}
            className={cn(
              "w-full bg-muted/40 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30",
              isDirty && "ring-1 ring-amber-500/50",
            )}
          />
          {isSecret && (
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showValue ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
        {isDirty && (
          <div className="flex items-center px-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleOption({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

function CommandLine({
  command,
  description,
  highlight,
}: {
  command: string;
  description: string;
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors",
        highlight
          ? "bg-primary/10 border border-primary/20"
          : "hover:bg-zinc-800",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-emerald-400 font-mono text-xs">$</span>
        <code className="text-zinc-200 font-mono text-xs truncate">
          {command}
        </code>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-zinc-500 text-[10px] hidden sm:block">
          {description}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            copied
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700",
          )}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * JSON Override Editor - allows raw JSON editing of settings
 */
function JsonOverrideEditor({
  settings,
  onSave,
  isSaving,
}: {
  settings?: SettingsType;
  onSave: (settings: Partial<SettingsType>) => void;
  isSaving: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [jsonValue, setJsonValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize JSON when settings load or editing starts
  useEffect(() => {
    if (settings && isEditing) {
      const formatted = JSON.stringify(settings, null, 2);
      setJsonValue(formatted);
      setHasChanges(false);
      setError(null);
    }
  }, [settings, isEditing]);

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    setHasChanges(true);

    // Validate JSON
    try {
      JSON.parse(value);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      onSave(parsed);
      setIsEditing(false);
      setHasChanges(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleDiscard = () => {
    setIsEditing(false);
    setJsonValue("");
    setError(null);
    setHasChanges(false);
  };

  const handleCopyToClipboard = async () => {
    const text = settings ? JSON.stringify(settings, null, 2) : "{}";
    await navigator.clipboard.writeText(text);
    toast.success("Settings copied to clipboard");
  };

  if (!isEditing) {
    // Preview mode - show formatted JSON with option to edit
    return (
      <div className="space-y-4">
        {/* Preview Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Current settings as JSON
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyToClipboard}
              className="h-8 rounded-lg"
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-8 rounded-lg"
            >
              <Code2 className="h-3.5 w-3.5 mr-1.5" />
              Edit JSON
            </Button>
          </div>
        </div>

        {/* JSON Preview */}
        <div className="rounded-xl overflow-hidden border border-border">
          {/* Header bar */}
          <div className="bg-muted/80 px-4 py-2 flex items-center gap-2 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-[10px] text-muted-foreground ml-2 font-mono">
              settings.json
            </span>
          </div>

          {/* JSON Content */}
          <pre className="bg-zinc-950 dark:bg-zinc-900 p-4 overflow-x-auto max-h-75 overflow-y-auto">
            <code className="text-xs font-mono text-zinc-300 whitespace-pre">
              {settings ? JSON.stringify(settings, null, 2) : "Loading..."}
            </code>
          </pre>
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <AlertCircle className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-blue-400 mb-1">
              About JSON Override
            </p>
            <p>
              Edit settings directly as JSON for advanced configuration. Changes
              made here will override UI settings. Invalid JSON will be
              rejected.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Edit mode - full JSON editor
  return (
    <div className="space-y-4">
      {/* Editor Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Editing Raw JSON</span>
          {hasChanges && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={isSaving}
            className="h-8 rounded-lg text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !!error || !hasChanges}
            className="h-8 rounded-lg"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Apply JSON
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-red-400 mb-0.5">Invalid JSON</p>
            <p className="text-red-400/80 font-mono">{error}</p>
          </div>
        </div>
      )}

      {/* JSON Editor */}
      <div className="rounded-xl overflow-hidden border border-border">
        {/* Header bar */}
        <div
          className={cn(
            "px-4 py-2 flex items-center justify-between border-b",
            error
              ? "bg-red-500/10 border-red-500/20"
              : "bg-muted/80 border-border",
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-[10px] text-muted-foreground ml-2 font-mono">
              settings.json
            </span>
          </div>
          {!error && (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Valid JSON
            </span>
          )}
        </div>

        {/* Textarea Editor */}
        <textarea
          value={jsonValue}
          onChange={(e) => handleJsonChange(e.target.value)}
          className={cn(
            "w-full bg-zinc-950 dark:bg-zinc-900 p-4 font-mono text-xs text-zinc-300",
            "min-h-100 max-h-150 resize-y",
            "focus:outline-none focus:ring-0 border-none",
            error && "text-red-400",
          )}
          spellCheck={false}
          placeholder="{}"
        />
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-amber-400 mb-1">Caution</p>
          <p>
            Changes made here will completely replace your current settings.
            Make sure you understand the JSON structure before saving. Invalid
            configurations may cause unexpected behavior.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating Save Bar - appears at bottom when there are unsaved changes
 */
function FloatingSaveBar({
  hasPendingChanges,
  pendingChanges,
  onSave,
  onDiscard,
  isSaving,
}: {
  hasPendingChanges: boolean;
  pendingChanges: Partial<SettingsType>;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
}) {
  // Count the number of changed fields
  const changeCount = Object.values(pendingChanges).reduce((acc, category) => {
    if (typeof category === "object" && category !== null) {
      return acc + Object.keys(category).length;
    }
    return acc;
  }, 0);

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "transition-all duration-300 ease-out",
        hasPendingChanges
          ? "translate-y-0 opacity-100"
          : "translate-y-20 opacity-0 pointer-events-none",
      )}
    >
      <div className="flex items-center gap-4 px-6 py-3 rounded-2xl glass-heavy shadow-float border border-primary/20">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm font-medium">
            {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
