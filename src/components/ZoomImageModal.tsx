import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

function distance(touches: any[]) {
  if (touches.length < 2) return 0;
  const [a, b] = touches;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function ZoomImageModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const startScale = useRef(1);
  const startDistance = useRef(0);
  const startOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!url) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [url]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      startScale.current = scale;
      startDistance.current = distance(event.nativeEvent.touches);
      startOffset.current = offset;
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const base = startDistance.current || distance(touches);
        const next = base ? startScale.current * (distance(touches) / base) : startScale.current;
        setScale(clamp(next, 1, 5));
        return;
      }
      if (scale > 1) {
        setOffset({
          x: startOffset.current.x + gesture.dx,
          y: startOffset.current.y + gesture.dy,
        });
      }
    },
    onPanResponderRelease: () => {
      if (scale <= 1.02) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    },
  }), [offset, scale]);

  return (
    <Modal visible={!!url} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shade}>
        <TouchableOpacity style={styles.close} onPress={onClose}>
          <Text style={styles.closeText}>关闭</Text>
        </TouchableOpacity>
        {url ? (
          <View style={styles.stage} {...responder.panHandlers}>
            <Image
              source={{ uri: url }}
              resizeMode="contain"
              style={[
                styles.image,
                {
                  transform: [
                    { translateX: offset.x },
                    { translateY: offset.y },
                    { scale },
                  ],
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 42, right: 18, zIndex: 2, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  closeText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  image: { width: '100%', height: '100%' },
});
