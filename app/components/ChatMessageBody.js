import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import {getSignedUrlForMessage} from '../services/messageService';

export default function ChatMessageBody({item, textStyle}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (item.message_type === 'image' && item.file_bucket && item.file_path) {
      setLoading(true);
      setImageError(false);
      setImageUrl(null);
      getSignedUrlForMessage({
        file_bucket: item.file_bucket,
        file_path: item.file_path,
      })
        .then(url => {
          if (!cancelled) {
            setImageUrl(url);
            setLoading(false);
            if (!url) {
              setImageError(true);
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoading(false);
            setImageError(true);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [item.file_bucket, item.file_path, item.message_type]);

  if (item.message_type === 'image') {
    const hasFile = Boolean(item.file_bucket && item.file_path);
    return (
      <View>
        {hasFile ? (
          loading ? (
            <ActivityIndicator size="small" />
          ) : imageUrl && !imageError ? (
            <Image
              source={{uri: imageUrl}}
              style={{width: 200, height: 200, borderRadius: 8, marginBottom: 6, backgroundColor: '#E2E8F0'}}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <Text style={[textStyle, {marginBottom: 6, fontStyle: 'italic'}]}>
              Unable to load image. Try opening the chat again or resend the photo.
            </Text>
          )
        ) : null}
        {item.text && item.text !== 'Photo' ? (
          <Text style={textStyle}>{item.text}</Text>
        ) : null}
      </View>
    );
  }

  if (item.message_type === 'file') {
    return (
      <View>
        <TouchableOpacity
          onPress={async () => {
            const url = await getSignedUrlForMessage({
              file_bucket: item.file_bucket,
              file_path: item.file_path,
            });
            if (url) {
              Linking.openURL(url);
            }
          }}>
          <Text style={[textStyle, {textDecorationLine: 'underline'}]}>
            {item.file_name ? `📎 ${item.file_name}` : '📎 Open file'}
          </Text>
        </TouchableOpacity>
        {item.text && item.text !== 'Attachment' ? (
          <Text style={[textStyle, {marginTop: 4}]}>{item.text}</Text>
        ) : null}
      </View>
    );
  }

  return <Text style={textStyle}>{item.text}</Text>;
}
