import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Icon mapping from lucide-react-native names to MaterialCommunityIcons
const iconMap = {
  Search: 'magnify',
  SlidersHorizontal: 'tune',
  Calendar: 'calendar',
  FileText: 'file-document',
  Check: 'check',
  X: 'close',
  Clock: 'clock-outline',
  ChevronLeft: 'chevron-left',
  ChevronRight: 'chevron-right',
  CheckCircle2: 'check-circle',
  ShieldCheck: 'shield-check',
  Wallet: 'wallet',
  Info: 'information',
  ArrowLeft: 'arrow-left',
  Paperclip: 'paperclip',
  Send: 'send',
  MessageSquare: 'message-text-outline',
  AlertCircle: 'alert-circle',
  Gavel: 'gavel',
  Minus: 'minus',
  Plus: 'plus',
  Hash: 'pound',
  Inbox: 'inbox',
  Filter: 'filter',
  BarChart3: 'chart-bar',
  TrendingUp: 'trending-up',
  DollarSign: 'currency-usd',
  Eye: 'eye',
  EyeOff: 'eye-off',
  Phone: 'phone',
  MapPin: 'map-pin',
  Star: 'star',
  Heart: 'heart',
  Share2: 'share-variant',
  Trash2: 'trash-can',
  Edit2: 'pencil',
  LogOut: 'logout',
  Settings: 'cog',
  Bell: 'bell',
  Menu: 'menu',
  Home: 'home',
  User: 'account',
};

export const createIcon = (iconName, size = 24, color = '#000') => {
  const mappedIcon = iconMap[iconName] || iconName;
  
  return (
    <MaterialCommunityIcons
      name={mappedIcon}
      size={size}
      color={color}
    />
  );
};

// Export individual icon components for compatibility
export const Icon = ({ name, size = 24, color = '#000' }) => {
  const mappedIcon = iconMap[name] || name;
  
  return (
    <MaterialCommunityIcons
      name={mappedIcon}
      size={size}
      color={color}
    />
  );
};

// Export icons as named exports for destructuring compatibility
Object.keys(iconMap).forEach(lucideName => {
  exports[lucideName] = ({ size = 24, color = '#000' }) => (
    <MaterialCommunityIcons
      name={iconMap[lucideName]}
      size={size}
      color={color}
    />
  );
});
