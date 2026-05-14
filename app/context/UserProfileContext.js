import React, {createContext, useContext, useMemo, useState, useCallback, useEffect} from 'react';
import {loadCachedProfile, saveCachedProfile} from '../services/profileCache';

const UserProfileContext = createContext(null);

const initialProfile = {
  name: '',
  email: '',
  phone: '',
  address: '',
  age: '',
  guardian_name: '',
  guardian_contact: '',
  role: 'Client',
};

export const UserProfileProvider = ({children}) => {
  const [profile, setProfile] = useState(initialProfile);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedProfile();
      if (cancelled || !cached) return;
      setProfile(prev => ({
        ...prev,
        ...cached,
        name: cached.name ?? prev.name,
        email: cached.email ?? prev.email,
        role: cached.role ?? prev.role,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateProfile = useCallback(updates => {
    setProfile(previous => {
      const next = {
        ...previous,
        ...updates,
      };
      saveCachedProfile(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      profile,
      updateProfile,
      setProfile,
    }),
    [profile, updateProfile],
  );

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useUserProfile = () => {
  const context = useContext(UserProfileContext);

  if (!context) {
    throw new Error('useUserProfile must be used within UserProfileProvider');
  }

  return context;
};