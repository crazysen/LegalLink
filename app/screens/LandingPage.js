import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ImageBackground,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

const PressScaleButton = ({ children, onPress, style, contentStyle, scaleTo = 0.96 }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 26,
      bounciness: 8,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
      style={style}
    >
      <Animated.View style={[contentStyle, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

const FEATURE_ITEMS = [
  {
    number: '01',
    title: 'High-touch legal guidance',
    description: 'Direct, responsive support with a clear strategy at every stage.',
  },
  {
    number: '02',
    title: 'Confidential by design',
    description: 'Built for sensitive matters where privacy and trust matter most.',
  },
  {
    number: '03',
    title: 'Sharp execution',
    description: 'Focused preparation, clean communication, and disciplined follow-through.',
  },
  {
    number: '04',
    title: 'Business-ready thinking',
    description: 'Practical legal perspective for individuals, founders, and companies.',
  },
];

const SERVICE_ITEMS = [
  {
    title: 'Corporate and Business Law',
    description: 'Contracts, compliance, and legal structure support for growing teams and enterprises.',
  },
  {
    title: 'Civil Litigation',
    description: 'Case strategy, representation, and dispute resolution focused on your best outcome.',
  },
  {
    title: 'Family and Property Matters',
    description: 'Clear legal guidance for family rights, ownership, transfers, and settlements.',
  },
  {
    title: 'Consultation and Advisory',
    description: 'Private consultations for preventive legal planning and risk-aware decision making.',
  },
];

const AnarnaLawScreen = ({navigation}) => {
  const [showServicesModal, setShowServicesModal] = useState(false);
  const pageOpacity = useRef(new Animated.Value(0)).current;
  const pageTranslateY = useRef(new Animated.Value(22)).current;
  const pageScale = useRef(new Animated.Value(0.985)).current;
  const bgScale = useRef(new Animated.Value(0)).current;
  const bgShift = useRef(new Animated.Value(0)).current;
  const orbitLeft = useRef(new Animated.Value(0)).current;
  const orbitRight = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const ctaPulse = useRef(new Animated.Value(0)).current;
  const heroFloat = useRef(new Animated.Value(0)).current;
  const modalProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pageOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageTranslateY, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageScale, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bgScale, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(bgShift, {
          toValue: 1,
          duration: 8000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgShift, {
          toValue: 0,
          duration: 8000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(orbitLeft, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(orbitLeft, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(orbitRight, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(orbitRight, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(ctaPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ctaPulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(heroFloat, {
          toValue: 1,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(heroFloat, {
          toValue: 0,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [bgScale, bgShift, ctaPulse, glowPulse, heroFloat, orbitLeft, orbitRight, pageOpacity, pageScale, pageTranslateY]);

  const openServicesModal = () => {
    setShowServicesModal(true);
    requestAnimationFrame(() => {
      Animated.timing(modalProgress, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const closeServicesModal = () => {
    Animated.timing(modalProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowServicesModal(false);
      }
    });
  };

  const pageStyle = {
    opacity: pageOpacity,
    transform: [{ translateY: pageTranslateY }, { scale: pageScale }],
  };

  const bgTransform = {
    transform: [
      {
        scale: bgScale.interpolate({
          inputRange: [0, 1],
          outputRange: [1.12, 1.22],
        }),
      },
      {
        translateY: bgShift.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -20],
        }),
      },
    ],
  };

  const pulseScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.18],
  });

  const leftDrift = orbitLeft.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -22],
  });

  const rightDrift = orbitRight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 24],
  });

  const ctaGlow = ctaPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.52],
  });

  const heroFloatY = heroFloat.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  const modalOverlayOpacity = modalProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const modalTranslateY = modalProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  const modalScale = modalProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backgroundLayer} pointerEvents="none">
        <AnimatedImageBackground
          source={require('../assets/images/bg.jpg')}
          resizeMode="cover"
          style={[styles.backgroundImage, bgTransform]}
        >
          <View style={styles.backgroundOverlay} />
          <View style={styles.backgroundShadeTop} />
          <View style={styles.backgroundShadeBottom} />
        </AnimatedImageBackground>

        <Animated.View
          style={[
            styles.orb,
            styles.orbLeft,
            {
              opacity: glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }),
              transform: [{ translateY: leftDrift }, { scale: pulseScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orb,
            styles.orbRight,
            {
              opacity: glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.92] }),
              transform: [{ translateY: rightDrift }, { scale: pulseScale }],
            },
          ]}
        />
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.header, pageStyle]}>
          <View style={styles.brandBlock}>
            <View style={styles.brandRow}>
              <Image source={require('../assets/images/logo.jpg')} style={styles.brandLogo} />
              <Text style={styles.brandWordmark}>Batas Mo</Text>
            </View>
            <Text style={styles.brandSubtitle}>Precision, discretion, and modern counsel.</Text>
          </View>
          <PressScaleButton
            style={styles.signInButtonWrap}
            contentStyle={styles.signInButton}
            onPress={() => navigation.navigate('LoginSignup')}
            scaleTo={0.94}
          >
            <Text style={styles.signInButtonText}>SIGN IN</Text>
          </PressScaleButton>
        </Animated.View>

        <Animated.View style={[styles.heroShell, pageStyle, { transform: [{ translateY: heroFloatY }] }]}>
          <View style={styles.heroHeadlineBlock}>
            <Text style={styles.headline}>Legal strategy.</Text>
            <Text style={[styles.headline, styles.goldHeadline]}>Clarity.</Text>
            <Text style={styles.headline}>Control.</Text>
          </View>

          <Text style={styles.subheadline}>
            A calm, high-trust legal presence for clients who expect discretion, speed, and precision.
          </Text>

          <View style={styles.actionStack}>
            <PressScaleButton
              style={styles.primaryButtonWrap}
              contentStyle={styles.primaryButton}
              onPress={() => navigation.navigate('LoginSignup')}
              scaleTo={0.95}
            >
              <Animated.View style={[styles.buttonSheen, { opacity: ctaGlow }]} />
              <Text style={styles.primaryButtonText}>GET STARTED</Text>
            </PressScaleButton>

            <PressScaleButton
              style={styles.secondaryButtonWrap}
              contentStyle={styles.secondaryButton}
              onPress={openServicesModal}
              scaleTo={0.97}
            >
              <Text style={styles.secondaryButtonText}>VIEW SERVICES</Text>
            </PressScaleButton>
          </View>
        </Animated.View>

        <Animated.View style={[styles.statsPanel, pageStyle]}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>15+</Text>
            <Text style={styles.statLabel}>YEARS EXPERIENCE</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statValue}>2,000+</Text>
            <Text style={styles.statLabel}>MATTERS HANDLED</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={styles.statValue}>98%</Text>
            <Text style={styles.statLabel}>SUCCESS RATE</Text>
          </View>
        </Animated.View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Why clients choose us</Text>
          <Text style={styles.sectionSubtitle}>
            Measured, discreet, and designed for high-stakes work.
          </Text>
        </View>

        {FEATURE_ITEMS.map((item, index) => (
          <FeatureCard
            key={item.number}
            number={item.number}
            title={item.title}
            description={item.description}
            delay={index * 140}
          />
        ))}
      </Animated.ScrollView>

      <Modal transparent visible={showServicesModal} animationType="none" onRequestClose={closeServicesModal}>
        <Animated.View style={[styles.servicesOverlay, { opacity: modalOverlayOpacity }]}>
          <TouchableOpacity style={styles.servicesBackdropTap} activeOpacity={1} onPress={closeServicesModal} />

          <Animated.View
            style={[
              styles.servicesSheet,
              {
                transform: [{ translateY: modalTranslateY }, { scale: modalScale }],
              },
            ]}
          >
            <View style={styles.servicesHeader}>
              <Text style={styles.servicesTitle}>Our Services</Text>
              <PressScaleButton
                style={styles.servicesCloseWrap}
                contentStyle={styles.servicesCloseButton}
                onPress={closeServicesModal}
                scaleTo={0.92}
              >
                <Text style={styles.servicesCloseText}>CLOSE</Text>
              </PressScaleButton>
            </View>

            {SERVICE_ITEMS.map((service, index) => (
              <View key={service.title} style={styles.serviceItem}>
                <Text style={styles.serviceNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.serviceCopy}>
                  <Text style={styles.serviceTitle}>{service.title}</Text>
                  <Text style={styles.serviceDescription}>{service.description}</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
};

const FeatureCard = ({ number, title, description, delay = 0 }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 650,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 650,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 650,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, scale, translateY]);

  return (
    <Animated.View style={[styles.card, { opacity, transform: [{ translateY }, { scale }] }]}>
      <View style={styles.cardRow}>
        <View style={styles.cardNumberPill}>
          <Text style={styles.cardNumber}>{number}</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardDescription}>{description}</Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050b0d',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 10, 12, 0.18)',
  },
  backgroundShadeTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '44%',
    backgroundColor: 'rgba(3, 9, 11, 0.2)',
  },
  backgroundShadeBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '56%',
    backgroundColor: 'rgba(3, 9, 11, 0.86)',
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbLeft: {
    top: 74,
    left: -58,
    width: 200,
    height: 200,
    backgroundColor: 'rgba(212, 175, 55, 0.18)',
    shadowColor: '#d4af37',
    shadowOpacity: 0.22,
    shadowRadius: 30,
  },
  orbRight: {
    top: 360,
    right: -72,
    width: 260,
    height: 260,
    backgroundColor: 'rgba(120, 204, 187, 0.16)',
    shadowColor: '#78ccbb',
    shadowOpacity: 0.18,
    shadowRadius: 30,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 46,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  brandBlock: {
    flex: 1,
    paddingRight: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  brandLogo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  brandWordmark: {
    color: '#f6f8f8',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  brandSubtitle: {
    color: '#9ea9aa',
    fontSize: 12,
    lineHeight: 17,
  },
  signInButton: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 18, 26, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.28)',
    shadowColor: '#000',
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  signInButtonWrap: {
    borderRadius: 999,
  },
  signInButtonText: {
    color: '#d4af37',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  heroShell: {
    backgroundColor: 'rgba(7, 18, 20, 0.56)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 30,
    padding: 18,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
    overflow: 'hidden',
  },
  heroHeadlineBlock: {
    marginBottom: 14,
  },
  headline: {
    color: '#f6f8f8',
    fontSize: 46,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 50,
    letterSpacing: 0.2,
  },
  goldHeadline: {
    color: '#d4af37',
  },
  subheadline: {
    color: '#b1bcbc',
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  actionStack: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#d4af37',
    borderRadius: 18,
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#d4af37',
    shadowOpacity: 0.42,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
    overflow: 'hidden',
  },
  primaryButtonWrap: {
    borderRadius: 18,
  },
  buttonSheen: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 8,
    bottom: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  primaryButtonText: {
    color: '#081315',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.4,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.38)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 16,
    borderRadius: 18,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButtonWrap: {
    borderRadius: 18,
  },
  secondaryButtonText: {
    color: '#d4af37',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.4,
  },
  statsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 26,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  statCard: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 42,
    backgroundColor: 'rgba(212, 175, 55, 0.18)',
  },
  statValue: {
    color: '#d4af37',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#9ca8a9',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '800',
    letterSpacing: 0.9,
    lineHeight: 13,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f6f8f8',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  sectionSubtitle: {
    color: '#a8b3b4',
    fontSize: 13,
    marginTop: 5,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: 15,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  cardNumberPill: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.18)',
    backgroundColor: 'rgba(212, 175, 55, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardNumber: {
    color: '#d4af37',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.2,
  },
  cardCopy: {
    flex: 1,
    paddingTop: 2,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },
  cardDescription: {
    color: '#b0bcbc',
    fontSize: 15,
    lineHeight: 22,
  },
  servicesOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 12, 0.74)',
    justifyContent: 'flex-end',
  },
  servicesBackdropTap: {
    flex: 1,
  },
  servicesSheet: {
    backgroundColor: 'rgba(8, 18, 24, 0.98)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
    elevation: 8,
  },
  servicesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  servicesTitle: {
    color: '#f6f8f8',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  servicesCloseWrap: {
    borderRadius: 999,
  },
  servicesCloseButton: {
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.36)',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  servicesCloseText: {
    color: '#d4af37',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  serviceItem: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
  },
  serviceNumber: {
    color: 'rgba(212, 175, 55, 0.86)',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    paddingTop: 3,
  },
  serviceCopy: {
    flex: 1,
  },
  serviceTitle: {
    color: '#f6f8f8',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  serviceDescription: {
    color: '#a9b5b7',
    fontSize: 13,
    lineHeight: 19,
  },
});

export default AnarnaLawScreen;
