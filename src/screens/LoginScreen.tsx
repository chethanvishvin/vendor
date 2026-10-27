import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Image,
  Keyboard,
} from 'react-native';
import { apiService } from '../api/apiService';
import { VendorProfile } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (vendor: VendorProfile) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [contactNumber, setContactNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const scrollViewRef = useRef<any>(null);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setIsKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleContactNumberChange = (text: string) => {
    // Restrict input strictly to digits and limit to 10 characters
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 10);
    setContactNumber(digitsOnly);
    if (errorMessage) setErrorMessage(null);
  };

  const handleLogin = async () => {
    Keyboard.dismiss();
    const cleanedNumber = contactNumber.replace(/[^0-9]/g, '');
    if (!cleanedNumber) {
      setErrorMessage('Please enter your 10-digit registered mobile number.');
      return;
    }
    if (cleanedNumber.length !== 10) {
      setErrorMessage('Mobile number must be exactly 10 digits.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Please enter your access password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await apiService.login({
        contactNumber: cleanedNumber,
        password: password.trim(),
      });

      if (response && response.status && response.data) {
        const isWorker =
          response.userType === 'VendorWorker' ||
          Boolean(response.data.VendorWorkerId) ||
          response.data.RoleId === 9;
        const isVendor =
          response.userType === 'Vendor' ||
          response.data.RoleId === 8 ||
          (!isWorker && Boolean(response.data.VendorId));

        const roleId = response.data.RoleId
          ? Number(response.data.RoleId)
          : isWorker
            ? 9
            : 8;
        const workerId = response.data.VendorWorkerId || (response.data as any).WorkerId;

        // 1. Role Authorization check
        if (!isVendor && !isWorker) {
          setErrorMessage(
            `Access Denied: Unrecognized User Type or Role. Only registered Vendors and Vendor Workers can sign in.`,
          );
          return;
        }

        // 2. Normalize user profile for app-wide compatibility
        const normalizedProfile: VendorProfile = {
          ...response.data,
          RoleId: roleId,
          VendorWorkerId: workerId,
          WorkerId: workerId,
          userType: isWorker ? 'VendorWorker' : 'Vendor',
          VendorName:
            (isWorker
              ? response.data.UserName
              : response.data.VendorName || response.data.CompanyName) || 'Vendor User',
          CompanyName:
            response.data.CompanyName ||
            (isWorker ? 'Field Operations' : response.data.VendorName || 'Vendor Company'),
          ContactNumber:
            response.data.ContactNumber || response.data.MobileNumber || contactNumber.trim(),
          ContactPerson:
            response.data.ContactPerson || response.data.UserName || response.data.VendorName || (isWorker ? 'Worker' : 'Vendor'),
          CreatedByUserName:
            (isWorker ? response.data.UserName : response.data.VendorName) ||
            response.data.CreatedByUserName ||
            (isWorker ? 'Vendor Worker' : 'Vendor'),
        };

        onLoginSuccess(normalizedProfile);
      } else {
        setErrorMessage(response.message || 'Authentication failed. Please verify credentials.');
      }
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Unable to connect to RNA Service. Please check network connection.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToInput = (isPassword = false) => {
    setTimeout(() => {
      if (scrollViewRef.current) {
        if (isPassword) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        } else {
          scrollViewRef.current.scrollTo({ y: 120, animated: true });
        }
      }
    }, 150);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.scrollContent,
          isKeyboardVisible && styles.scrollContentWithKeyboard,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        
        {/* Top Branding Header */}
        <View style={[styles.brandContainer, isKeyboardVisible && styles.brandContainerCompact]}>
          <View style={[styles.logoBadge, isKeyboardVisible && styles.logoBadgeCompact]}>
            <Image
              source={require('../assets/logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.portalTag}>RNA SERVICE PLATFORM</Text>
          <Text style={[styles.brandTitle, isKeyboardVisible && styles.brandTitleCompact]}>Vendor Portal</Text>
          {!isKeyboardVisible && (
            <Text style={styles.brandSubtitle}>
              Substation Installation Monitoring & Field Guidance
            </Text>
          )}
        </View>

        {/* Login Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardDesc}>
              Enter your registered mobile number and password to access assigned substations.
            </Text>
          </View>

          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Contact Number Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>REGISTERED MOBILE NUMBER</Text>
            <View style={styles.inputWrapper}>
              <View style={styles.phonePrefix}>
                <Text style={styles.prefixText}>🇮🇳 +91</Text>
              </View>
              <TextInput
                style={styles.textInput}
                value={contactNumber}
                onChangeText={handleContactNumberChange}
                onFocus={() => scrollToInput(false)}
                placeholder="Enter 10-digit mobile number"
                placeholderTextColor="#64748B"
                keyboardType="number-pad"
                maxLength={10}
                autoCapitalize="none"
                editable={!isLoading}
              />
              {contactNumber.length > 0 && (
                <TouchableOpacity
                  onPress={() => setContactNumber('')}
                  style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>PASSWORD</Text>
            </View>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.textInput, { paddingLeft: 16 }]}
                value={password}
                onChangeText={setPassword}
                onFocus={() => scrollToInput(true)}
                placeholder="Enter password"
                placeholderTextColor="#64748B"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                editable={!isLoading}
              />
              {password.length > 0 && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => setPassword('')}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.eyeText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Submit Action */}
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.85}>
            {isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitButtonText}>Authenticating...</Text>
              </View>
            ) : (
              <Text style={styles.submitButtonText}>Authorize & Sign In ➔</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Security / System Footer */}
        <View style={styles.footerContainer}>
    
          <Text style={styles.footerCopyright}>
            Enterprise Field Operations • Power Grid Telemetry & Monitoring
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 30,
    justifyContent: 'center',
    flexGrow: 1,
  },
  scrollContentWithKeyboard: {
    justifyContent: 'flex-start',
    paddingTop: 16,
    paddingBottom: 280,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandContainerCompact: {
    marginBottom: 10,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
  },
  logoBadgeCompact: {
    width: 48,
    height: 48,
    borderRadius: 14,
    marginBottom: 6,
    padding: 6,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  portalTag: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  brandTitle: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  brandTitleCompact: {
    fontSize: 20,
    marginBottom: 4,
  },
  brandSubtitle: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardHeader: {
    marginBottom: 20,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  cardDesc: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 18,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    overflow: 'hidden',
  },
  phonePrefix: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#F1F5F9',
    borderRightWidth: 1,
    borderRightColor: '#CBD5E1',
  },
  prefixText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  textInput: {
    flex: 1,
    color: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  clearBtn: {
    paddingHorizontal: 12,
  },
  clearBtnText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eyeText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '800',
  },
  submitButton: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerContainer: {
    alignItems: 'center',
    marginTop: 28,
  },
  footerCopyright: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
  },
});
