import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  ImageBackground,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  ACCOUNT_CREATED_HEADER_MARGIN_TOP,
  FONT_SERIF_DISPLAY,
} from '../constants/platformUi';

const THEME = {
  textMain: '#f6f8f8',
  textSecondary: '#a7b4b7',
  success: '#4ADE80',
  buttonBlue: '#1D4ED8',
};

const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

export default function AccountCreated({navigation, route}) {
  const role = route?.params?.role || 'Client';
  const isAttorney = role === 'Attorney';

  const introOpacity = useRef(new Animated.Value(0)).current;
  const introScale = useRef(new Animated.Value(0.9)).current;
  const bgDrift = useRef(new Animated.Value(0)).current;
  const auraA = useRef(new Animated.Value(0)).current;
  const auraB = useRef(new Animated.Value(0)).current;
  const checkPop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {toValue: 1, duration: 600, useNativeDriver: true}),
      Animated.spring(introScale, {toValue: 1, friction: 8, useNativeDriver: true}),
      Animated.spring(checkPop, {toValue: 1, friction: 4, tension: 40, delay: 400, useNativeDriver: true}),
    ]).start();

    const loop = (ref, duration) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(ref, {toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
          Animated.timing(ref, {toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
        ])
      ).start();
    };

    loop(bgDrift, 9000);
    loop(auraA, 2500);
    loop(auraB, 3500);
  }, [auraA, auraB, bgDrift, checkPop, introOpacity, introScale]);

  const goToDashboard = () => {
    navigation.reset({
      index: 0,
      routes: [{name: isAttorney ? 'AttyLandingPage' : 'HomepageClient'}],
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.backgroundLayer} pointerEvents="none">
        <AnimatedImageBackground
          source={require('../assets/images/bg.jpg')}
          resizeMode="cover"
          style={[
            styles.backgroundImage,
            {
              transform: [
                {
                  translateY: bgDrift.interpolate({inputRange: [0, 1], outputRange: [0, -18]}),
                },
              ],
            },
          ]}>
          <View style={styles.tintDeepBlue} />
          <View style={styles.tintDark} />
        </AnimatedImageBackground>
        <Animated.View style={[styles.aura, styles.auraLeft, {opacity: auraA.interpolate({inputRange: [0, 1], outputRange: [0.2, 0.5]})}]} />
        <Animated.View style={[styles.aura, styles.auraRight, {opacity: auraB.interpolate({inputRange: [0, 1], outputRange: [0.15, 0.4]})}]} />
      </View>

      <Animated.View style={[styles.mainContent, {opacity: introOpacity, transform: [{scale: introScale}]}]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => navigation.reset({index: 0, routes: [{name: 'Landing'}]})} style={styles.closeIcon}>
            <Ionicons name="close" size={24} color={THEME.textMain} />
          </TouchableOpacity>
          <Text style={styles.headerLabel}>Account Created</Text>
          <View style={{width: 40}} />
        </View>

        <View style={styles.cardContainer}>
          <Animated.View style={[styles.checkCircle, {transform: [{scale: checkPop}]}]}>
            <View style={styles.checkInner}>
              <Ionicons name="checkmark" size={48} color={THEME.success} />
            </View>
            <View style={styles.checkGlow} />
          </Animated.View>

          <Text style={styles.welcomeTitle}>Welcome to BatasMo!</Text>
          <Text style={styles.welcomeSub}>
            Your account has been successfully created. You can now start connecting with legal professionals.
          </Text>

          <TouchableOpacity activeOpacity={0.85} style={styles.dashboardButton} onPress={goToDashboard}>
            <Text style={styles.buttonText}>Go to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#050b12'},
  backgroundLayer: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  backgroundImage: {...StyleSheet.absoluteFillObject, left: -24, right: -24, top: -24, bottom: -24},
  tintDeepBlue: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4, 18, 44, 0.75)'},
  tintDark: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3, 9, 15, 0.4)'},
  aura: {position: 'absolute', borderRadius: 999},
  auraLeft: {top: 50, left: -120, width: 350, height: 350, backgroundColor: 'rgba(75, 121, 214, 0.15)'},
  auraRight: {bottom: 100, right: -120, width: 350, height: 350, backgroundColor: 'rgba(212, 175, 55, 0.08)'},

  mainContent: {flex: 1, paddingHorizontal: 20},
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    marginTop: ACCOUNT_CREATED_HEADER_MARGIN_TOP,
  },
  headerLabel: {
    color: THEME.textMain,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeIcon: {width: 40, height: 40, justifyContent: 'center'},

  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  checkInner: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(74, 222, 128, 0.4)',
  },
  checkGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(74, 222, 128, 0.05)',
    zIndex: -1,
  },
  welcomeTitle: {
    color: THEME.textMain,
    fontSize: 32,
    fontWeight: '900',
    fontFamily: FONT_SERIF_DISPLAY,
    textAlign: 'center',
    marginBottom: 16,
  },
  welcomeSub: {
    color: THEME.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  dashboardButton: {
    backgroundColor: THEME.buttonBlue,
    width: '100%',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: THEME.buttonBlue,
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: {width: 0, height: 8},
    elevation: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
