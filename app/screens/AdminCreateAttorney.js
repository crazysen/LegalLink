import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AdminCreateAttorney({ navigation }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [prcId, setPrcId] = useState('');
  const [expertise, setExpertise] = useState('');
  const [password, setPassword] = useState('');

  const handleCreate = () => {
    if (!fullName || !email || !prcId || !expertise || !password) {
      return Alert.alert('Error', 'All fields are required to establish a legitimate Attorney profile.');
    }
    // In a real app, this would hit the Supabase backend to generate the Auth user and Profile record
    Alert.alert('Success', 'Attorney account successfully created and added to the platform.');
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack?.()}>
          <Ionicons name="arrow-back" size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Portal</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create Attorney Account</Text>
        <Text style={styles.subtitle}>Backend portal to exclusively create and verify Attorneys.</Text>

        <Text style={styles.label}>Full Name</Text>
        <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Dr. Sarah Johnson" />

        <Text style={styles.label}>Email Address</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="sarah.johnson@legal.com" keyboardType="email-address" />

        <Text style={styles.label}>Temporary Password</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

        <Text style={styles.label}>PRC License ID</Text>
        <TextInput style={styles.input} value={prcId} onChangeText={setPrcId} placeholder="1234567" keyboardType="numeric" />

        <Text style={styles.label}>Areas of Expertise (Comma separated)</Text>
        <TextInput style={styles.input} value={expertise} onChangeText={setExpertise} placeholder="Corporate Law, Mergers, Real Estate" />

        <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
          <Text style={styles.submitBtnText}>Create Attorney Match</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: '#FFF' },
  headerTitle: { fontSize: 18, fontWeight: '700', marginLeft: 15, color: '#1E293B' },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0F172A', marginBottom: 5 },
  subtitle: { fontSize: 14, color: '#64748B', marginBottom: 25 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 14, marginBottom: 20, color: '#1E293B' },
  submitBtn: { backgroundColor: '#114BCB', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});
