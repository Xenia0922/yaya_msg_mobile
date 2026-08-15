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
import { useUiStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

interface OrderItem {
  dataId: string;
  goodsName: string;
  totalFee: string;
  tradeTime: string;
  invoiceStatus: number;
  companyId: string;
  selected: boolean;
}

export default function InvoiceScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const statusLabels = [t('可开票'), t('申请中'), t('已开票')];
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
    if (!selected.length) { Alert.alert(t('提示'), t('请选择要开票的订单')); return; }
    if (!buyerName.trim()) { Alert.alert(t('提示'), t('请填写发票抬头')); return; }
    if (!notifyEmail.trim()) { Alert.alert(t('提示'), t('请填写接收邮箱')); return; }
    setSubmitting(true);
    try {
      await pocketApi.applyElectronicInvoice({
        buyerType, buyerName, buyerTaxNo, buyerAddress, buyerPhone,
        buyerBankName, buyerBankAccount, notifyEmail, notifyMobile,
        orderDataId: selected.map((o) => o.dataId),
      });
      showToast(t('开票申请已提交'));
      fetchOrders();
    } catch (e: any) { Alert.alert(t('提交失败'), errorMessage(e)); }
    finally { setSubmitting(false); }
  };

  const renderOrder = ({ item, index }: { item: OrderItem; index: number }) => {
    const disabled = item.invoiceStatus !== 0;
    const selected = item.selected;
    return (
      <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
        <TouchableOpacity
          style={[
            styles.orderCard,
            {
              backgroundColor: palette.surface,
              borderColor: selected ? palette.tint : palette.hairline,
            },
            disabled && styles.cardDisabled,
          ]}
          onPress={() => !disabled && toggleOrder(item.dataId)}
          disabled={disabled}
          activeOpacity={disabled ? 1 : 0.85}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: selected ? palette.tint : palette.labelTertiary,
                backgroundColor: selected ? palette.tint : 'transparent',
              },
            ]}
          >
            {selected ? <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" /> : null}
          </View>
          <View style={styles.orderInfo}>
            <Text style={[styles.orderName, { color: palette.label }]} numberOfLines={2}>{item.goodsName}</Text>
            <Text style={[styles.orderMeta, { color: palette.labelSecondary }]}>¥{item.totalFee} · {item.tradeTime}</Text>
          </View>
          <Text style={[styles.statusText, { color: disabled ? palette.labelTertiary : '#20a464' }]}>
            {statusLabels[item.invoiceStatus] || t('未知')}
          </Text>
        </TouchableOpacity>
      </FadeInView>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('电子发票')} onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={fetchOrders}>
          <Text style={[styles.headerAction, { color: palette.tint }]}>{t('刷新')}</Text>
        </TouchableOpacity>
      } />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: palette.label }]}>
          {t('可开票订单 ({count})', { count: canInvoice })}{selectedCount > 0 ? t(' · 已选 {count} 单', { count: selectedCount }) : ''}
        </Text>
        {error ? (
          <View style={styles.errorRow}>
            <Text style={[styles.errorText, { color: palette.tint }]} numberOfLines={2}>{error}</Text>
            <TouchableOpacity style={[styles.retryBtn, { backgroundColor: palette.tint }]} onPress={fetchOrders}>
              <Text style={styles.retryBtnText}>{t('重试')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {orders.map((item, index) => renderOrder({ item, index }))}
        {orders.length === 0 && !loading && !error ? (
          <Text style={[styles.empty, { color: palette.labelTertiary }]}>{t('暂无订单')}</Text>
        ) : null}
        {loading && <ActivityIndicator color={palette.tint} style={{ padding: 16 }} />}

        <View
          style={[
            styles.formCard,
            {
              backgroundColor: palette.surface,
              borderColor: palette.hairline,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: palette.label }]}>{t('开票信息')}</Text>

          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[
                styles.typeBtn,
                { backgroundColor: buyerType === 0 ? palette.tint : palette.fill2 },
              ]}
              onPress={() => setBuyerType(0)}
            >
              <Text style={[styles.typeText, { color: buyerType === 0 ? '#FFFFFF' : palette.labelSecondary }]}>{t('个人')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.typeBtn,
                { backgroundColor: buyerType === 1 ? palette.tint : palette.fill2 },
              ]}
              onPress={() => setBuyerType(1)}
            >
              <Text style={[styles.typeText, { color: buyerType === 1 ? '#FFFFFF' : palette.labelSecondary }]}>{t('企业')}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('发票抬头')}</Text>
          <TextInput
            style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]}
            value={buyerName}
            onChangeText={setBuyerName}
            placeholder={t('输入发票抬头')}
            placeholderTextColor={palette.labelTertiary}
          />

          {buyerType === 1 && (
            <>
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('纳税人识别号')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={buyerTaxNo} onChangeText={setBuyerTaxNo} placeholder={t('输入纳税人识别号')} placeholderTextColor={palette.labelTertiary} autoCapitalize="characters" />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('企业地址')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={buyerAddress} onChangeText={setBuyerAddress} placeholder={t('输入企业地址')} placeholderTextColor={palette.labelTertiary} />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('企业电话')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={buyerPhone} onChangeText={setBuyerPhone} placeholder={t('输入企业电话')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('开户银行')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={buyerBankName} onChangeText={setBuyerBankName} placeholder={t('输入开户银行')} placeholderTextColor={palette.labelTertiary} />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('银行账号')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={buyerBankAccount} onChangeText={setBuyerBankAccount} placeholder={t('输入银行账号')} placeholderTextColor={palette.labelTertiary} keyboardType="numeric" />
            </>
          )}

          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('接收邮箱')}</Text>
          <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={notifyEmail} onChangeText={setNotifyEmail} placeholder={t('输入邮箱地址')} placeholderTextColor={palette.labelTertiary} keyboardType="email-address" />
          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('手机号')}</Text>
          <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.surface, borderColor: palette.innerStroke, color: palette.label }]} value={notifyMobile} onChangeText={setNotifyMobile} placeholder={t('输入手机号')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" />

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.tint }, (submitting || !selectedCount) && styles.disabledBtn]}
            onPress={handleSubmit}
            disabled={submitting || !selectedCount}
          >
            <Text style={styles.submitText}>
              {submitting ? t('提交中...') : t('提交申请 (已选 {count} 单)', { count: selectedCount })}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 60 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, paddingHorizontal: 4 },
  errorText: { color: '#ff6f91', fontSize: 13, flex: 1, lineHeight: 18 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14 },
  retryBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, padding: 12, marginBottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardDisabled: { opacity: 0.5 },
  checkbox: {
    width: 22, height: 22, borderRadius: 7,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  orderInfo: { flex: 1 },
  orderName: { fontSize: 14, fontWeight: '700' },
  orderMeta: { fontSize: 12, marginTop: 3 },
  statusText: { fontSize: 12, fontWeight: '800', marginLeft: 8 },
  formCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeRow: { flexDirection: 'row', marginBottom: 12, gap: 6 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 16 },
  typeText: { fontSize: 14, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input: {
    padding: 10, borderRadius: 14, fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fillInput: {},
  submitBtn: { backgroundColor: '#ff6f91', borderRadius: 18, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  disabledBtn: { opacity: 0.45 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
