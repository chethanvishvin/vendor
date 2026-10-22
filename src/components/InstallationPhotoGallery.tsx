import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import { CompletedStationFile } from '../types';
import { apiService } from '../api/apiService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PhotoItemProps {
  file: CompletedStationFile;
  onPress: (uri: string, file: CompletedStationFile) => void;
}

const PhotoThumbnail: React.FC<PhotoItemProps> = ({ file, onPress }) => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setHasError(false);

    apiService
      .fetchInstallationImageBase64(file.installationSubmissionFileId)
      .then(uri => {
        if (isMounted) {
          setImageUri(uri);
          setIsLoading(false);
        }
      })
      .catch(err => {
        console.warn('Failed to load image:', file.installationSubmissionFileId, err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [file.installationSubmissionFileId]);

  const getBadgeTitle = (name: string) => {
    if (name.toLowerCase().includes('installation')) return '📸 Installation';
    if (name.toLowerCase().includes('unknow')) return '📄 Site Proof';
    return `📎 ${name}`;
  };

  return (
    <TouchableOpacity
      style={styles.thumbnailWrap}
      activeOpacity={0.8}
      disabled={isLoading || hasError || !imageUri}
      onPress={() => imageUri && onPress(imageUri, file)}>
      <View style={styles.imageContainer}>
        {isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="small" color="#38BDF8" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : hasError || !imageUri ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>Failed</Text>
          </View>
        ) : (
          <Image
            source={{ uri: imageUri }}
            style={styles.thumbnailImage}
            resizeMode="cover"
          />
        )}
        <View style={styles.badgeOverlay}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {getBadgeTitle(file.fileTypeName)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

interface InstallationPhotoGalleryProps {
  files: CompletedStationFile[];
}

export const InstallationPhotoGallery: React.FC<InstallationPhotoGalleryProps> = ({
  files,
}) => {
  const [activePhoto, setActivePhoto] = useState<{
    uri: string;
    file: CompletedStationFile;
  } | null>(null);

  if (!files || files.length === 0) {
    return (
      <View style={styles.emptyGallery}>
        <Text style={styles.emptyGalleryText}>No installation photos uploaded.</Text>
      </View>
    );
  }

  return (
    <View style={styles.galleryContainer}>
      <Text style={styles.galleryHeading}>
        📷 Installation Evidence & Photos ({files.length})
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}>
        {files.map(file => (
          <PhotoThumbnail
            key={file.installationSubmissionFileId}
            file={file}
            onPress={(uri, f) => setActivePhoto({ uri, file: f })}
          />
        ))}
      </ScrollView>

      {/* Fullscreen Photo Viewer Modal */}
      <Modal
        visible={!!activePhoto}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setActivePhoto(null)}>
        <View style={styles.fullscreenOverlay}>
          {/* Header Bar */}
          <View style={styles.fullscreenHeader}>
            <View style={styles.fullscreenTitleWrap}>
              <Text style={styles.fullscreenType}>
                {activePhoto?.file.fileTypeName || 'Installation Photo'}
              </Text>
              <Text style={styles.fullscreenFilename} numberOfLines={1}>
                {activePhoto?.file.fileName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.fullscreenCloseBtn}
              onPress={() => setActivePhoto(null)}
              activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Large Image Preview */}
          <View style={styles.fullscreenBody}>
            {activePhoto?.uri ? (
              <Image
                source={{ uri: activePhoto.uri }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            ) : null}
          </View>

          {/* Footer info */}
          <View style={styles.fullscreenFooter}>
            <Text style={styles.fullscreenFooterText}>
              File ID #{activePhoto?.file.installationSubmissionFileId} • Type #{activePhoto?.file.fileTypeId}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  galleryContainer: {
    marginTop: 12,
  },
  galleryHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  scrollList: {
    paddingVertical: 2,
    gap: 10,
  },
  thumbnailWrap: {
    width: 110,
    height: 110,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 4,
  },
  errorIcon: {
    fontSize: 18,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 10,
    marginTop: 2,
  },
  badgeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyGallery: {
    paddingVertical: 8,
  },
  emptyGalleryText: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 15, 0.96)',
    justifyContent: 'space-between',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? Math.max((StatusBar.currentHeight || 0) + 16, 52) : 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  fullscreenTitleWrap: {
    flex: 1,
    marginRight: 16,
  },
  fullscreenType: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  fullscreenFilename: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  fullscreenCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
  },
  fullscreenBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  fullscreenImage: {
    width: SCREEN_WIDTH - 16,
    height: SCREEN_HEIGHT * 0.7,
  },
  fullscreenFooter: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  fullscreenFooterText: {
    color: '#64748B',
    fontSize: 12,
  },
});
