import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore, useUiStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';

interface OrderItem {
  dataId: string;
  goodsName: string;
  totalFee: string;
  tradeTime: string;
  invoiceStatus: number;
  companyId: string;
  selected: boolean;
}

const STATUS_LABELS = ['可开票', '申请中', '已开票'];

export default function InvoiceScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const showToast = useUiStore((state) => state.showToast);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyerType, setBuyerType] = useState(0);
  const [buyerName, setBuyerName] = useState('');
  const [buyerTaxNo, setBuyerTaxNo] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerBankName, setBuyerBankName] = useState('');
  const [buyerBankAccount, setBuyerBankAccount] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyMobile, setNotifyMobile] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canInvoice = orders.filter((o) => o.invoiceStatus === 0).length;
  const selectedCount = orders.filter((o) => o.selected).length;

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await pocketApi.getInvoiceOrderList();
      const data = res?.content || res?.data || {};
      const list = unwrapList(data?.orderList || data?.list || data);
      setOrders((Array.isArray(list) ? list : []).map((item: any) => ({
        dataId: String(item.dataId || item.id || ''),
        goodsName: String(item.goodsName || item.name || ''),
        totalFee: String(item.totalFee || item.fee || '0'),
        tradeTime: String(item.tradeTime || item.time || ''),
        invoiceStatus: Number(item.invoiceStatus ?? item.status ?? 0),
        companyId: String(item.companyId || ''),
        selected: false,
      })));
    } catch (e: any) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchOrders(); }, []);

  const toggleOrder = (dataId: string) => {
    setOrders((prev) => prev.map((o) => (o.dataId === dataId ? { ...o, selected: !o.selected } : o)));
  };

  const handleSubmit = async () => {
    const selected = orders.filter((o) => o.selected);
    if (!selected.length) { Alert.alert('提示', '请选择要开票的订单'); return; }
    if (!buyerName.trim()) { Alert.alert('提示', '请填写发票抬头'); return; }
    if (!notifyEmail.trim()) { Alert.alert('提示', '请填写接收邮箱'); return; }
    setSubmitting(true);
    try {
      await pocketApi.applyElectronicInvoice({
        buyerType, buyerName, buyerTaxNo, buyerAddress, buyerPhone,
        buyerBankName, buyerBankAccount, notifyEmail, notifyMobile,
        orderDataId: selected.map((o) => o.dataId),
      });
      showToast('开票申请已提交');
      fetchOrders();
    } catch (e: any) { Alert.alert('提交失败', errorMessage(e)); }
    finally { setSubmitting(false); }
  };

  const renderOrder = ({ item, index }: { item: OrderItem; index: number }) => {
    const disabled = item.invoiceStatus !== 0;
    return (
      <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
        <TouchableOpacity
          style={[styles.orderCard, isDark && styles.cardDark, disabled && { opacity: 0.5 }]}
          onPress={() => !disabled && toggleOrder(item.dataId)}
          disabled={disabled}
          activeOpacity={disabled ? 1 : 0.85}
        >
          {!disabled && (
            <View style={[styles.checkbox, item.selected && styles.checkboxActive]}>
              {item.selected ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
          )}
          <View style={styles.orderInfo}>
            <Text style={[styles.orderName, isDark && styles.textLight]} numberOfLines={2}>{item.goodsName}</Text>
            <Text style={[styles.orderMeta, isDark && styles.textSubLight]}>¥{item.totalFee} · {item.tradeTime}</Text>
          </View>
          <Text style={[styles.statusText, { color: disabled ? (isDark ? '#aaaaaa' : '#888888') : '#20a464' }]}>
            {STATUS_LABELS[item.invoiceStatus] || '未知'}
          </Text>
        </TouchableOpacity>
      </FadeInView>
    );
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="电子发票" onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={fetchOrders}>
          <Text style={styles.headerAction}>刷新</Text>
        </TouchableOpacity>
      } />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          可开票订单 ({canInvoice}){selectedCount > 0 ? ` · 已选 ${selectedCount} 单` : ''}
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {orders.map((item, index) => renderOrder({ item, index }))}
        {orders.length === 0 && !loading ? (
          <Text style={[styles.empty, isDark && styles.textSubLight]}>暂无订单</Text>
        ) : null}
        {loading && <ActivityIndicator color="#ff6f91" style={{ padding: 16 }} />}

        <View style={styles.formWrap}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight, { marginTop: 12 }]}>开票信息</Text>

          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeBtn, buyerType === 0 && styles.typeBtnActive]}
              onPress={() => setBuyerType(0)}
            >
              <Text style={[styles.typeText, isDark && styles.textSubLight, buyerType === 0 && styles.typeTextActive]}>个人</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, buyerType === 1 && styles.typeBtnActive]}
              onPress={() => setBuyerType(1)}
            >
              <Text style={[styles.typeText, isDark && styles.textSubLight, buyerType === 1 && styles.typeTextActive]}>企业</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, isDark && styles.textSubLight]}>发票抬头</Text>
          <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerName} onChangeText={setBuyerName} placeholder="输入发票抬头" placeholderTextColor={isDark ? '#888' : '#999'} />

          {buyerType === 1 && (
            <>
              <Text style={[styles.label, isDark && styles.textSubLight]}>纳税人识别号</Text>
              <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerTaxNo} onChangeText={setBuyerTaxNo} placeholder="输入纳税人识别号" placeholderTextColor={isDark ? '#888' : '#999'} autoCapitalize="characters" />
              <Text style={[styles.label, isDark && styles.textSubLight]}>企业地址</Text>
              <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerAddress} onChangeText={setBuyerAddress} placeholder="输入企业地址" placeholderTextColor={isDark ? '#888' : '#999'} />
              <Text style={[styles.label, isDark && styles.textSubLight]}>企业电话</Text>
              <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerPhone} onChangeText={setBuyerPhone} placeholder="输入企业电话" placeholderTextColor={isDark ? '#888' : '#999'} keyboardType="phone-pad" />
              <Text style={[styles.label, isDark && styles.textSubLight]}>开户银行</Text>
              <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerBankName} onChangeText={setBuyerBankName} placeholder="输入开户银行" placeholderTextColor={isDark ? '#888' : '#999'} />
              <Text style={[styles.label, isDark && styles.textSubLight]}>银行账号</Text>
              <TextInput style={[styles.input, isDark && styles.inputDark]} value={buyerBankAccount} onChangeText={setBuyerBankAccount} placeholder="输入银行账号" placeholderTextColor={isDark ? '#888' : '#999'} keyboardType="numeric" />
            </>
          )}

          <Text style={[styles.label, isDark && styles.textSubLight]}>接收邮箱</Text>
          <TextInput style={[styles.input, isDark && styles.inputDark]} value={notifyEmail} onChangeText={setNotifyEmail} placeholder="输入邮箱地址" placeholderTextColor={isDark ? '#888' : '#999'} keyboardType="email-address" />
          <Text style={[styles.label, isDark && styles.textSubLight]}>手机号</Text>
          <TextInput style={[styles.input, isDark && styles.inputDark]} value={notifyMobile} onChangeText={setNotifyMobile} placeholder="输入手机号" placeholderTextColor={isDark ? '#888' : '#999'} keyboardType="phone-pad" />

          <TouchableOpacity
            style={[styles.submitBtn, (submitting || !selectedCount) && { opacity: 0.45 }]}
            onPress={handleSubmit}
            disabled={submitting || !selectedCount}
          >
            <Text style={styles.submitText}>
              {submitting ? '提交中...' : `提交申请 (已选 ${selectedCount} 单)`}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  scroll: { padding: 12, paddingBottom: 60 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#333333', marginBottom: 8 },
  errorText: { color: '#ff6f91', fontSize: 13, marginBottom: 8, paddingHorizontal: 4 },
  empty: { color: '#555555', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 14, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  cardDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.10)' },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxActive: { borderColor: '#ff6f91', backgroundColor: '#ff6f91' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  orderInfo: { flex: 1 },
  orderName: { fontSize: 14, fontWeight: '700', color: '#333333' },
  orderMeta: { fontSize: 12, color: '#555555', marginTop: 3 },
  statusText: { fontSize: 12, fontWeight: '800', marginLeft: 8 },
  formWrap: {},
  typeRow: { flexDirection: 'row', marginBottom: 12, gap: 6 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(238,238,238,0.72)' },
  typeBtnActive: { backgroundColor: '#ff6f91' },
  typeText: { fontSize: 14, fontWeight: '800', color: '#555555' },
  typeTextActive: { color: '#fff' },
  label: { fontSize: 13, fontWeight: '600', color: '#555555', marginBottom: 4, marginTop: 8 },
  input: {
    padding: 10, borderRadius: 16, fontSize: 14, color: '#333333',
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
  },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.68)', borderColor: 'rgba(255,255,255,0.14)', color: '#eeeeee' },
  submitBtn: { backgroundColor: '#ff6f91', borderRadius: 20, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
