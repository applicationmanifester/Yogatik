import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, Plus, X, Search, Globe, Lock, Download,
  Menu, ChevronDown, Refresh, Home, Star, Eye, EyeOff,
  Layout, LayoutList, RotateCcw, Copy, Minimize, Maximize,
  FileText, Table, Languages, Volume2, Folder
} from 'lucide-react';
import './BrowserChrome.css';

// ============================================
// DESIGN TOKENS (mirrored from 16-design-tokens.css)
// ============================================
const tokens = {
  // Control geometry
  controlHeight: {
    sm: '28px',
    md: '36px',
    lg: '44px',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '18px',
    pill: '9999px',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
  },
  // Elevation
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 12px rgba(0,0,0,0.08)',
    lg: '0 12px 28px rgba(0,0,0,0.12)',
    xl: '0 20px 40px rgba(0,0,0,0.15)',
  },
  // Colors (CSS custom properties will be used at runtime)
  // These are fallbacks
  color: {
    bg: 'var(--color-bg, #ffffff)',
    bgSecondary: 'var(--color-bg-secondary, #f5f5f5)',
    bgTeritary: 'var(--color-bg-tertiary, #eaeaea)',
    fg: 'var(--color-fg, #1a1a1a)',
    fgMuted: 'var(--color-fg-muted, #666666)',
    border: 'var(--color-border, #e0e0e0)',
    accent: 'var(--color-accent, #0066cc)',
    accentHover: 'var(--color-accent-hover, #0052a3)',
    danger: 'var(--color-danger, #dc2626)',
    success: 'var(--color-success, #16a34a)',
    warning: 'var(--color-warning, #f59e0b)',
  },
  // Motion
  motion: {
    fast: '120ms',
    base: '200ms',
    slow: '320ms',
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    easingSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  // Breakpoints
  breakpoint: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  },
};

// ============================================
// UTILITY HOOKS
// ============================================
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mediaQuery.matches);
    const handler = (e) => setReduced(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  return reduced;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// ============================================
// ICON COMPONENT
// ============================================
const Icon = ({ icon: IconComponent, size = 16, className = '', 'aria-hidden': ariaHidden = true, ...props }) => (
  <IconComponent
    size={size}
    className={className}
    aria-hidden={ariaHidden}
    {...props}
  />
);

// Icon map for AI actions
const AI_ACTION_ICONS = {
  FileText,
  Table,
  Languages,
  Volume2,
  Folder,
};

// ============================================
// ADDRESS BAR
// ============================================
export function AddressBar({
  value,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  securityState = 'secure', // 'secure' | 'insecure' | 'mixed' | 'internal'
  favicon,
  isLoading = false,
  placeholder = 'Search or enter address',
  autoSelect = false,
  disabled = false,
  showActions = true,
}) {
  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (autoSelect && inputRef.current) {
      inputRef.current.select();
    }
  }, [autoSelect]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      inputRef.current?.blur();
      setShowSuggestions(false);
    }
  };

  const securityIcons = {
    secure: <Icon icon={Lock} size={14} className="security-secure" title="Connection is secure" />,
    insecure: <Icon icon={Globe} size={14} className="security-insecure" title="Connection not secure" />,
    mixed: <Icon icon={Lock} size={14} className="security-mixed" title="Mixed content" />,
    internal: <Icon icon={Home} size={14} className="security-internal" title="Internal page" />,
  };

  return (
    <div
      className={`address-bar ${isFocused ? 'focused' : ''} ${securityState}`}
      role="search"
      style={{ 
        '--control-h': tokens.controlHeight.md,
        '--radius': tokens.radius.pill,
      }}
    >
      <div className="address-bar-left">
        <button
          className="security-indicator"
          aria-label={securityIcons[securityState]?.props?.title}
          tabIndex={-1}
        >
          {securityIcons[securityState]}
        </button>
        {favicon && (
          <img
            className="favicon"
            src={favicon}
            alt=""
            width={16}
            height={16}
            aria-hidden="true"
          />
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        className="address-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={(e) => {
          setIsFocused(true);
          setShowSuggestions(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          setTimeout(() => setShowSuggestions(false), 150);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        onSubmit={onSubmit}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-controls="address-suggestions"
        aria-expanded={showSuggestions}
        style={{ 
          '--control-h': tokens.controlHeight.md,
        }}
      />

      {showActions && (
        <div className="address-bar-right">
          {isLoading && (
            <div className="loading-spinner" aria-hidden="true" />
          )}
          <button
            className="icon-btn refresh-btn"
            onClick={() => window.electronAPI?.browser?.reload?.()}
            aria-label="Refresh"
            tabIndex={-1}
          >
            <Icon icon={RotateCcw} size={16} />
          </button>
          <button
            className="icon-btn star-btn"
            aria-label="Bookmark this page"
            tabIndex={-1}
          >
            <Icon icon={Star} size={16} />
          </button>
          <button
            className="icon-btn menu-btn"
            aria-label="Page actions"
            tabIndex={-1}
          >
            <Icon icon={Menu} size={16} />
          </button>
        </div>
      )}

      {showSuggestions && (
        <div
          id="address-suggestions"
          className="address-suggestions"
          role="listbox"
        >
          <div className="suggestion-group">
            <span className="suggestion-label">Search</span>
            <button className="suggestion-item" role="option">
              <Icon icon={Search} size={14} />
              <span>Search for "{value}"</span>
            </button>
          </div>
          <div className="suggestion-group">
            <span className="suggestion-label">History</span>
            <button className="suggestion-item" role="option">
              <Icon icon={RotateCcw} size={14} />
              <span>Recently visited</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// TAB COMPONENT
// ============================================
export function Tab({
  id,
  title = 'New Tab',
  favicon,
  isActive = false,
  isPinned = false,
  isMuted = false,
  isLoading = false,
  securityState = 'secure',
  onClick,
  onClose,
  onPin,
  onMute,
  onDragStart,
  children,
}) {
  const tabRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  const handleClose = (e) => {
    e.stopPropagation();
    onClose?.(id);
  };

  const handlePin = (e) => {
    e.stopPropagation();
    onPin?.(id, !isPinned);
  };

  const handleMute = (e) => {
    e.stopPropagation();
    onMute?.(id, !isMuted);
  };

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    tabRef.current?.classList.add('dragging');
    onDragStart?.(id, e);
  };

  const handleDragEnd = () => {
    tabRef.current?.classList.remove('dragging');
  };

  const maxTitleLength = isPinned ? 0 : 180;
  const displayTitle = title.length > maxTitleLength && maxTitleLength > 0
    ? title.slice(0, maxTitleLength) + '…'
    : title;

  return (
    <div
      ref={tabRef}
      className={`tab ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isMuted ? 'muted' : ''} ${isLoading ? 'loading' : ''} ${isHovered ? 'hovered' : ''}`}
      role="tab"
      aria-selected={isActive}
      aria-label={isPinned ? `Pinned: ${title}` : title}
      tabIndex={isActive ? 0 : -1}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      draggable={true}
      style={{ 
        '--control-h': tokens.controlHeight.sm,
        '--radius': tokens.radius.md,
        '--tab-min-width': isPinned ? '36px' : '180px',
        '--tab-max-width': isPinned ? '36px' : '280px',
      }}
    >
      {!isPinned && (
        <div className="tab-favicon" aria-hidden="true">
          {favicon ? (
            <img src={favicon} alt="" width={16} height={16} />
          ) : (
            <Icon icon={Globe} size={14} className="default-favicon" />
          )}
          {isLoading && <div className="tab-loading" aria-hidden="true" />}
        </div>
      )}

      {!isPinned && (
        <span className="tab-title" title={title}>
          {displayTitle}
        </span>
      )}

      <div className="tab-actions">
        {isMuted && (
          <Icon icon={EyeOff} size={12} className="muted-icon" title="Muted" />
        )}
        {!isPinned && !isActive && isHovered && (
          <button
            className="icon-btn tab-close"
            onClick={handleClose}
            aria-label={`Close ${title}`}
            tabIndex={-1}
          >
            <Icon icon={X} size={12} />
          </button>
        )}
      </div>

      {isActive && !isPinned && (
        <div className="tab-indicator" aria-hidden="true" />
      )}
    </div>
  );
}

// ============================================
// TAB STRIP (Horizontal)
// ============================================
export function TabStrip({
  tabs = [],
  activeTabId,
  onTabClick,
  onTabClose,
  onTabPin,
  onTabMute,
  onTabReorder,
  onNewTab,
  maxTabsVisible = 8,
  showTabMenu = true,
  orientation = 'horizontal', // 'horizontal' | 'vertical'
}) {
  const stripRef = useRef(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [dragOverTab, setDragOverTab] = useState(null);
  const reducedMotion = useReducedMotion();
  const isWide = useMediaQuery(`(min-width: ${tokens.breakpoint.lg})`);

  const visibleTabs = useMemo(() => {
    const activeIndex = tabs.findIndex(t => t.id === activeTabId);
    if (activeIndex === -1) return tabs.slice(0, maxTabsVisible);
    
    const half = Math.floor(maxTabsVisible / 2);
    let start = Math.max(0, activeIndex - half);
    const end = Math.min(tabs.length, start + maxTabsVisible);
    if (end - start < maxTabsVisible) {
      start = Math.max(0, end - maxTabsVisible);
    }
    return tabs.slice(start, end);
  }, [tabs, activeTabId, maxTabsVisible]);

  const scrollLeft = () => {
    setScrollOffset(prev => Math.max(0, prev - 200));
  };

  const scrollRight = () => {
    const maxScroll = stripRef.current?.scrollWidth - stripRef.current?.clientWidth || 0;
    setScrollOffset(prev => Math.min(maxScroll, prev + 200));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tabId = e.currentTarget.dataset.tabId;
    setDragOverTab(tabId);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/plain');
    const toId = e.currentTarget.dataset.tabId;
    if (fromId && toId && fromId !== toId) {
      onTabReorder?.(fromId, toId);
    }
    setDragOverTab(null);
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
  };

  if (orientation === 'vertical') {
    return (
      <VerticalTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onTabPin={onTabPin}
        onTabMute={onTabMute}
        onNewTab={onNewTab}
      />
    );
  }

  return (
    <div className="tab-strip-container" role="tablist" aria-label="Browser tabs">
      <button
        className="scroll-btn scroll-left"
        onClick={scrollLeft}
        aria-label="Scroll tabs left"
        disabled={scrollOffset === 0}
        tabIndex={-1}
      >
        <Icon icon={ChevronLeft} size={16} />
      </button>

      <div
        ref={stripRef}
        className="tab-strip"
        role="presentation"
        style={{ transform: `translateX(-${scrollOffset}px)` }}
      >
        {visibleTabs.map((tab) => (
          <Tab
            key={tab.id}
            {...tab}
            isActive={tab.id === activeTabId}
            onClick={() => onTabClick?.(tab.id)}
            onClose={onTabClose}
            onPin={onTabPin}
            onMute={onTabMute}
            onDragStart={(id, e) => {
              e.currentTarget.dataset.tabId = id;
            }}
          />
        ))}

        <button
          className="new-tab-btn"
          onClick={onNewTab}
          aria-label="New tab"
          tabIndex={0}
          style={{ '--control-h': tokens.controlHeight.sm }}
        >
          <Icon icon={Plus} size={18} />
        </button>
      </div>

      <button
        className="scroll-btn scroll-right"
        onClick={scrollRight}
        aria-label="Scroll tabs right"
        disabled={scrollOffset >= (stripRef.current?.scrollWidth - stripRef.current?.clientWidth || 0)}
        tabIndex={-1}
      >
        <Icon icon={ChevronRight} size={16} />
      </button>

      {showTabMenu && (
        <TabMenuButton tabs={tabs} activeTabId={activeTabId} onTabClick={onTabClick} />
      )}
    </div>
  );
}

// ============================================
// VERTICAL TAB STRIP
// ============================================
function VerticalTabStrip({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onTabPin,
  onTabMute,
  onNewTab,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const reducedMotion = useReducedMotion();

  const filteredTabs = tabs.filter(tab =>
    tab.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedTabs = filteredTabs.filter(t => t.isPinned);
  const regularTabs = filteredTabs.filter(t => !t.isPinned);

  return (
    <aside className={`vertical-tab-strip ${isCollapsed ? 'collapsed' : ''}`} role="tablist" aria-label="Vertical tabs">
      <div className="vertical-tabs-header">
        {!isCollapsed && (
          <input
            type="search"
            className="vertical-tabs-search"
            placeholder="Search tabs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search tabs"
            style={{ '--control-h': tokens.controlHeight.sm }}
          />
        )}
        <button
          className="icon-btn collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand tabs' : 'Collapse tabs'}
          tabIndex={-1}
        >
          <Icon icon={LayoutList} size={16} />
        </button>
      </div>

      <div className="vertical-tabs-content">
        {pinnedTabs.length > 0 && (
          <div className="tab-group">
            {!isCollapsed && <div className="tab-group-label">Pinned</div>}
            {pinnedTabs.map(tab => (
              <Tab
                key={tab.id}
                {...tab}
                isActive={tab.id === activeTabId}
                onClick={() => onTabClick?.(tab.id)}
                onClose={onTabClose}
                onPin={onTabPin}
                onMute={onTabMute}
              />
            ))}
          </div>
        )}

        <div className="tab-group">
          {!isCollapsed && regularTabs.length > 0 && pinnedTabs.length > 0 && (
            <div className="tab-group-label">Tabs</div>
          )}
          {regularTabs.map(tab => (
            <Tab
              key={tab.id}
              {...tab}
              isActive={tab.id === activeTabId}
              onClick={() => onTabClick?.(tab.id)}
              onClose={onTabClose}
              onPin={onTabPin}
              onMute={onTabMute}
            />
          ))}
        </div>

        <button
          className="new-tab-btn vertical-new-tab"
          onClick={onNewTab}
          aria-label="New tab"
          tabIndex={0}
        >
          <Icon icon={Plus} size={18} />
          {!isCollapsed && <span>New Tab</span>}
        </button>
      </div>
    </aside>
  );
}

// ============================================
// TAB MENU BUTTON (Horizontal mode)
// ============================================
function TabMenuButton({ tabs, activeTabId, onTabClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="tab-menu" ref={menuRef}>
      <button
        className="icon-btn tab-menu-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Tab menu"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={-1}
      >
        <Icon icon={ChevronDown} size={16} />
      </button>

      {isOpen && (
        <div className="tab-menu-dropdown" role="listbox">
          <div className="tab-menu-search">
            <Icon icon={Search} size={14} />
            <input
              type="search"
              placeholder="Search tabs…"
              aria-label="Search tabs"
              style={{ '--control-h': tokens.controlHeight.sm }}
            />
          </div>
          <div className="tab-menu-list" role="presentation">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab-menu-item ${tab.id === activeTabId ? 'active' : ''}`}
                role="option"
                aria-selected={tab.id === activeTabId}
                onClick={() => {
                  onTabClick?.(tab.id);
                  setIsOpen(false);
                }}
              >
                {tab.favicon && <img src={tab.favicon} alt="" width={16} height={16} />}
                <span className="tab-menu-title">{tab.title || 'New Tab'}</span>
                <button
                  className="icon-btn tab-menu-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Close handled by parent
                  }}
                  aria-label={`Close ${tab.title}`}
                >
                  <Icon icon={X} size={12} />
                </button>
              </button>
            ))}
          </div>
          <div className="tab-menu-footer">
            <button className="tab-menu-action" onClick={() => {}}>New Tab</button>
            <button className="tab-menu-action" onClick={() => {}}>New Window</button>
            <button className="tab-menu-action" onClick={() => {}}>New Incognito Window</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// TOOLBAR
// ============================================
export function Toolbar({
  children,
  left,
  center,
  right,
  className = '',
}) {
  return (
    <header className={`toolbar ${className}`} role="toolbar" aria-label="Browser toolbar">
      <div className="toolbar-section toolbar-left">
        {left}
      </div>
      <div className="toolbar-section toolbar-center">
        {center}
      </div>
      <div className="toolbar-section toolbar-right">
        {right}
        {children}
      </div>
    </header>
  );
}

// ============================================
// NAVIGATION BUTTONS
// ============================================
export function NavButton({ icon: IconComponent, label, onClick, disabled, children, ...props }) {
  return (
    <button
      className={`nav-btn ${disabled ? 'disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      {...props}
    >
      {children || <Icon icon={IconComponent} size={18} />}
    </button>
  );
}

// ============================================
// DOWNLOADS BUTTON / PANEL
// ============================================
export function DownloadsButton({
  count = 0,
  onClick,
  downloads = [],
  onClear,
  onOpenFile,
  onShowInFolder,
  onCancel,
  onRetry,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const recentDownloads = downloads.slice(-5).reverse();
  const hasActiveDownloads = downloads.some(d => d.state === 'progressing');

  return (
    <div className="downloads-button" ref={buttonRef}>
      <button
        className={`icon-btn downloads-btn ${hasActiveDownloads ? 'active' : ''} ${count > 0 ? 'has-downloads' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={count > 0 ? `${count} downloads` : 'Downloads'}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={-1}
      >
        <Icon icon={Download} size={18} />
        {count > 0 && (
          <span className="badge" aria-label={`${count} downloads`}>{count > 9 ? '9+' : count}</span>
        )}
        {hasActiveDownloads && <span className="pulse-indicator" aria-hidden="true" />}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="downloads-panel"
          role="listbox"
          aria-label="Recent downloads"
        >
          <div className="downloads-header">
            <h3>Downloads</h3>
            <div className="downloads-actions">
              <button className="icon-btn" onClick={onClear} aria-label="Clear all" tabIndex={-1}>
                <Icon icon={X} size={14} />
              </button>
              <button className="text-btn" onClick={() => {}} tabIndex={-1}>
                Show all
              </button>
            </div>
          </div>

          {recentDownloads.length === 0 ? (
            <div className="downloads-empty">
              <Icon icon={Download} size={32} />
              <p>No recent downloads</p>
            </div>
          ) : (
            <ul className="downloads-list" role="presentation">
              {recentDownloads.map(download => (
                <li key={download.id} className={`download-item ${download.state}`} role="option">
                  <div className="download-info">
                    <div className="download-icon">
                      {download.icon || <Icon icon={Download} size={20} />}
                    </div>
                    <div className="download-details">
                      <span className="download-name" title={download.name}>{download.name}</span>
                      <span className="download-progress">
                        {download.state === 'progressing' && (
                          <div className="progress-bar" role="progressbar" aria-valuenow={download.progress} aria-valuemin={0} aria-valuemax={100}>
                            <div className="progress-fill" style={{ width: `${download.progress}%` }} />
                          </div>
                          <span>{Math.round(download.progress)}%</span>
                        )}
                        {download.state === 'completed' && (
                          <Icon icon={Eye} size={12} className="success-icon" />
                        )}
                        {download.state === 'failed' && (
                          <Icon icon={EyeOff} size={12} className="error-icon" />
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="download-actions">
                    {download.state === 'progressing' && (
                      <button className="icon-btn" onClick={() => onCancel?.(download.id)} aria-label="Cancel" tabIndex={-1}>
                        <Icon icon={X} size={12} />
                      </button>
                    )}
                    {download.state === 'completed' && (
                      <button className="icon-btn" onClick={() => onOpenFile?.(download.id)} aria-label="Open" tabIndex={-1}>
                        <Icon icon={Eye} size={12} />
                      </button>
                    )}
                    {download.state === 'failed' && (
                      <button className="icon-btn" onClick={() => onRetry?.(download.id)} aria-label="Retry" tabIndex={-1}>
                        <Icon icon={RotateCcw} size={12} />
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => onShowInFolder?.(download.id)} aria-label="Show in folder" tabIndex={-1}>
                      <Icon icon={Minimize} size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// AD SHIELD BUTTON
// ============================================
export function AdShieldButton({ blockedCount = 0, onClick, onToggle, enabled = true }) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="adshield-button" ref={buttonRef}>
      <button
        className={`icon-btn adshield-btn ${enabled ? 'enabled' : 'disabled'} ${blockedCount > 0 ? 'has-blocked' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`AdShield: ${blockedCount} blocked on this page`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        tabIndex={-1}
      >
        <Icon icon={EyeOff} size={18} />
        {blockedCount > 0 && (
          <span className="badge">{blockedCount > 99 ? '99+' : blockedCount}</span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="adshield-panel"
          role="dialog"
          aria-label="AdShield protection"
        >
          <div className="adshield-header">
            <div className="adshield-status">
              <Icon icon={enabled ? EyeOff : Eye} size={24} className={enabled ? 'enabled' : 'disabled'} />
              <div>
                <strong>{enabled ? 'Protection ON' : 'Protection OFF'}</strong>
                <span>{blockedCount} trackers & ads blocked on this page</span>
              </div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggle?.(e.target.checked)}
              />
              <span className="toggle-slider" aria-hidden="true" />
            </label>
          </div>
          <div className="adshield-stats">
            <div className="stat">
              <span className="stat-value">{blockedCount}</span>
              <span className="stat-label">Blocked</span>
            </div>
            <div className="stat">
              <span className="stat-value">{Math.round(blockedCount * 0.3)}</span>
              <span className="stat-label">Trackers</span>
            </div>
            <div className="stat">
              <span className="stat-value">{Math.round(blockedCount * 0.7)}</span>
              <span className="stat-label">Ads</span>
            </div>
          </div>
          <div className="adshield-actions">
            <button className="text-btn" onClick={() => {}} tabIndex={-1}>Settings</button>
            <button className="text-btn" onClick={() => {}} tabIndex={-1}>Report issue</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// BOOKMARKS BAR
// ============================================
export function BookmarksBar({ items = [], onItemClick, onEdit, onDelete, onAddFolder }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleEdit = (item) => {
    setEditingId(item.id);
    setEditValue(item.title);
  };

  const handleSave = (item) => {
    onEdit?.(item.id, editValue);
    setEditingId(null);
    setEditValue('');
  };

  const handleKeyDown = (e, item) => {
    if (e.key === 'Enter') handleSave(item);
    if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
  };

  return (
    <div className="bookmarks-bar" role="toolbar" aria-label="Bookmarks">
      {items.map(item => item.type === 'folder' ? (
        <BookmarkFolder
          key={item.id}
          item={item}
          editingId={editingId}
          editValue={editValue}
          onEdit={handleEdit}
          onSave={handleSave}
          onKeyDown={handleKeyDown}
          onDelete={() => onDelete?.(item.id)}
          onItemClick={onItemClick}
        />
      ) : (
        <BookmarkItem
          key={item.id}
          item={item}
          editingId={editingId}
          editValue={editValue}
          onEdit={handleEdit}
          onSave={handleSave}
          onKeyDown={handleKeyDown}
          onDelete={() => onDelete?.(item.id)}
          onClick={() => onItemClick?.(item.url)}
        />
      ))}
      <button className="bookmark-add-btn" onClick={onAddFolder} aria-label="Add bookmark" tabIndex={0}>
        <Icon icon={Plus} size={16} />
      </button>
    </div>
  );
}

function BookmarkItem({ item, editingId, editValue, onEdit, onSave, onKeyDown, onDelete, onClick }) {
  const isEditing = editingId === item.id;

  if (isEditing) {
    return (
      <input
        type="text"
        className="bookmark-edit"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => onSave(item)}
        onKeyDown={(e) => onKeyDown(e, item)}
        autoFocus
        aria-label="Edit bookmark"
      />
    );
  }

  return (
    <button
      className="bookmark-item"
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onEdit(item); }}
      aria-label={item.title}
      tabIndex={-1}
    >
      {item.favicon && <img src={item.favicon} alt="" width={16} height={16} />}
      <span className="bookmark-title">{item.title}</span>
    </button>
  );
}

function BookmarkFolder({ item, editingId, editValue, onEdit, onSave, onKeyDown, onDelete, onItemClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const isEditing = editingId === item.id;

  if (isEditing) {
    return (
      <input
        type="text"
        className="bookmark-edit"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => onSave(item)}
        onKeyDown={(e) => onKeyDown(e, item)}
        autoFocus
        aria-label="Edit folder"
      />
    );
  }

  return (
    <div className="bookmark-folder">
      <button
        className="bookmark-folder-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={item.title}
        aria-expanded={isOpen}
        tabIndex={-1}
      >
        <Icon icon={Folder} size={16} />
        <span className="bookmark-title">{item.title}</span>
        <Icon icon={ChevronDown} size={12} className={isOpen ? 'open' : ''} />
      </button>
      {isOpen && (
        <div className="bookmark-folder-content">
          {item.children?.map(child => child.type === 'folder' ? (
            <BookmarkFolder
              key={child.id}
              item={child}
              editingId={editingId}
              editValue={editValue}
              onEdit={onEdit}
              onSave={onSave}
              onKeyDown={onKeyDown}
              onDelete={onDelete}
              onItemClick={onItemClick}
            />
          ) : (
            <BookmarkItem
              key={child.id}
              item={child}
              editingId={editingId}
              editValue={editValue}
              onEdit={onEdit}
              onSave={onSave}
              onKeyDown={onKeyDown}
              onDelete={onDelete}
              onClick={() => onItemClick?.(child.url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// SPLIT VIEW CONTROLS
// ============================================
export function SplitViewControls({ onSplitHorizontal, onSplitVertical, onCloseSplit, isSplit }) {
  return (
    <div className="split-view-controls" role="toolbar" aria-label="Split view">
      {isSplit ? (
        <button
          className="icon-btn split-close"
          onClick={onCloseSplit}
          aria-label="Close split view"
          tabIndex={-1}
        >
          <Icon icon={X} size={16} />
        </button>
      ) : (
        <>
          <button className="icon-btn" onClick={onSplitVertical} aria-label="Split vertically" tabIndex={-1}>
            <Icon icon={Layout} size={16} />
          </button>
          <button className="icon-btn" onClick={onSplitHorizontal} aria-label="Split horizontally" tabIndex={-1}>
            <Icon icon={LayoutList} size={16} />
          </button>
        </>
      )}
    </div>
  );
}

// ============================================
// READER MODE BUTTON
// ============================================
export function ReaderModeButton({ isAvailable, isActive, onToggle }) {
  return (
    <button
      className={`icon-btn reader-mode-btn ${isActive ? 'active' : ''} ${!isAvailable ? 'unavailable' : ''}`}
      onClick={onToggle}
      disabled={!isAvailable}
      aria-label={isActive ? 'Exit reader mode' : 'Enter reader mode'}
      aria-pressed={isActive}
      tabIndex={-1}
    >
      <Icon icon={LayoutList} size={18} />
    </button>
  );
}

// ============================================
// AI COMPANION BUTTON (Yogatik unique feature)
// ============================================
export function AICompanionButton({ isOpen, onToggle, onAction }) {
  const [showActions, setShowActions] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setShowActions(false);
      }
    }
    if (showActions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActions]);

  const actions = [
    { id: 'summarize', icon: FileText, label: 'Summarize page', shortcut: '⌘⇧S' },
    { id: 'extract', icon: Table, label: 'Extract data', shortcut: '⌘⇧E' },
    { id: 'find', icon: Search, label: 'Find similar', shortcut: '⌘⇧F' },
    { id: 'translate', icon: Languages, label: 'Translate', shortcut: '⌘⇧T' },
    { id: 'read', icon: Volume2, label: 'Read aloud', shortcut: '⌘⇧R' },
  ];

  return (
    <div className="ai-companion-button" ref={buttonRef}>
      <button
        className={`icon-btn ai-btn ${isOpen ? 'active' : ''}`}
        onClick={onToggle}
        aria-label="AI Companion"
        aria-expanded={isOpen}
        tabIndex={-1}
      >
        <Icon icon={Star} size={18} className="ai-icon" />
      </button>

      <button
        className="icon-btn ai-actions-btn"
        onClick={() => setShowActions(!showActions)}
        aria-label="AI Actions"
        aria-expanded={showActions}
        aria-haspopup="menu"
        tabIndex={-1}
      >
        <Icon icon={ChevronDown} size={14} />
      </button>

      {showActions && (
        <div ref={panelRef} className="ai-actions-panel" role="menu">
          <div className="ai-actions-header">
            <Icon icon={Star} size={20} className="ai-icon" />
            <span>AI Actions</span>
          </div>
          <ul className="ai-actions-list" role="presentation">
            {actions.map(action => (
              <li key={action.id}>
                <button
                  className="ai-action-item"
                  role="menuitem"
                  onClick={() => onAction?.(action.id)}
                  tabIndex={-1}
                >
                  <Icon icon={action.icon} size={16} />
                  <span>{action.label}</span>
                  <kbd>{action.shortcut}</kbd>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default {
  AddressBar,
  Tab,
  TabStrip,
  Toolbar,
  NavButton,
  DownloadsButton,
  AdShieldButton,
  BookmarksBar,
  SplitViewControls,
  ReaderModeButton,
  AICompanionButton,
};
