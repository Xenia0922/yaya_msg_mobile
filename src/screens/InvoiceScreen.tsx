import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useUiStore } from '../store';
import ScreenHeader from '../components/ScreenHeader';
import { FadeInView } from '../components/Motion';
import { HeaderAction } from '../components/HeaderAction';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { CenterSpinner } from '../components/Loaders';
import { EmptyState, ErrorState } from '../components/StateViews';
import pocketApi from '../api/pocket48';
import { errorMessage, unwrapList } from '../utils/data';
import { usePalette, radiiAlias } from '../theme';
import { useI18n } from '../i18n';

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
    const statusLabel = statusLabels[item.invoiceStatus] || t('未知');
    const statusColor =
      item.invoiceStatus === 0
        ? palette.success
        : item.invoiceStatus === 2
        ? palette.fill2
        : palette.labelTertiary;
    return (
      <FadeInView delay={index < 12 ? 60 + index * 25 : 0} duration={300}>
        <View style={[styles.orderCard, { backgroundColor: palette.surface, borderColor: selected ? palette.tint : palette.hairline }, disabled && styles.cardDisabled]}>
          {/* 订单信息 */}
          <View style={styles.orderInfo}>
            <Text style={[styles.orderName, { color: palette.label }]} numberOfLines={2}>{item.goodsName}</Text>
            <Text style={[styles.orderMeta, { color: palette.labelSecondary }]}>{item.tradeTime}</Text>
          </View>
          {/* 金额 15/800 */}
          <Text style={[styles.orderAmount, { color: palette.label }]}>¥{item.totalFee}</Text>
          {/* 状态徽标 */}
          <View style={[styles.statusPill, { backgroundColor: item.invoiceStatus === 0 ? 'rgba(52,199,89,0.14)' : palette.fill2 }]}>
            <Text style={[styles.statusPillText, { color: statusColor, opacity: item.invoiceStatus === 2 ? 0.65 : 1 }]}>{statusLabel}</Text>
          </View>
          {/* 操作：可开票 → 去开票 Pill；否则占位勾选 */}
          {!disabled ? (
            <Pill
              label={selected ? t('已选') : t('去开票')}
              selected={selected}
              onPress={() => toggleOrder(item.dataId)}
              style={styles.actionPill}
            />
          ) : (
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: palette.labelTertiary,
                  backgroundColor: 'transparent',
                  width: 24, height: 24,
                },
              ]}
            />
          )}
        </View>
      </FadeInView>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
    <View style={styles.container}>
      <ScreenHeader title={t('电子发票')} onBack={() => navigation.goBack()} right={
        <HeaderAction label={t('刷新')} onPress={fetchOrders} />
      } />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.sectionTitle, { color: palette.label }]}>
          {t('可开票订单 ({count})', { count: canInvoice })}{selectedCount > 0 ? t(' · 已选 {count} 单', { count: selectedCount }) : ''}
        </Text>
        {error ? (
          <ErrorState title={t('加载失败')} hint={error} onAction={() => fetchOrders()} />
        ) : null}
        {orders.map((item, index) => renderOrder({ item, index }))}
        {orders.length === 0 && !error ? (
          <EmptyState icon="receipt-outline" title={t('暂无订单')} />
        ) : null}

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
            <Pill
              label={t('个人')}
              selected={buyerType === 0}
              onPress={() => setBuyerType(0)}
              style={styles.typeBtn}
            />
            <Pill
              label={t('企业')}
              selected={buyerType === 1}
              onPress={() => setBuyerType(1)}
              style={styles.typeBtn}
            />
          </View>

          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('发票抬头')}</Text>
          <TextInput
            style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]}
            value={buyerName}
            onChangeText={setBuyerName}
            placeholder={t('输入发票抬头')}
            placeholderTextColor={palette.labelTertiary}
          />

          {buyerType === 1 && (
            <>
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('纳税人识别号')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={buyerTaxNo} onChangeText={setBuyerTaxNo} placeholder={t('输入纳税人识别号')} placeholderTextColor={palette.labelTertiary} autoCapitalize="characters" />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('企业地址')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={buyerAddress} onChangeText={setBuyerAddress} placeholder={t('输入企业地址')} placeholderTextColor={palette.labelTertiary} />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('企业电话')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={buyerPhone} onChangeText={setBuyerPhone} placeholder={t('输入企业电话')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('开户银行')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={buyerBankName} onChangeText={setBuyerBankName} placeholder={t('输入开户银行')} placeholderTextColor={palette.labelTertiary} />
              <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('银行账号')}</Text>
              <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={buyerBankAccount} onChangeText={setBuyerBankAccount} placeholder={t('输入银行账号')} placeholderTextColor={palette.labelTertiary} keyboardType="numeric" />
            </>
          )}

          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('接收邮箱')}</Text>
          <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={notifyEmail} onChangeText={setNotifyEmail} placeholder={t('输入邮箱地址')} placeholderTextColor={palette.labelTertiary} keyboardType="email-address" />
          <Text style={[styles.label, { color: palette.labelSecondary }]}>{t('手机号')}</Text>
          <TextInput style={[styles.input, styles.fillInput, { backgroundColor: palette.fill2, color: palette.label }]} value={notifyMobile} onChangeText={setNotifyMobile} placeholder={t('输入手机号')} placeholderTextColor={palette.labelTertiary} keyboardType="phone-pad" />

          <Button
            title={submitting ? t('提交中...') : t('提交申请 (已选 {count} 单)', { count: selectedCount })}
            onPress={handleSubmit}
            disabled={submitting || !selectedCount}
            loading={submitting}
            variant="filled"
            size="md"
            fullWidth
            style={styles.submitBtn}
          />
        </View>
      </ScrollView>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: 16, paddingBottom: 60 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radiiAlias.card, padding: 12, marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardDisabled: { opacity: 0.5 },
  orderInfo: { flex: 1, minWidth: 0, paddingRight: 8 },
  orderName: { fontSize: 13, fontWeight: '600' },
  orderMeta: { fontSize: 11, marginTop: 3 },
  orderAmount: { flexShrink: 0, fontSize: 15, fontWeight: '800', marginRight: 10 },
  statusPill: { flexShrink: 0, borderRadius: radiiAlias.chip, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  checkbox: {
    width: 22, height: 22, borderRadius: 7,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 0,
  },
  actionPill: { flexShrink: 0, marginLeft: 10 },
  formCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: radiiAlias.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeRow: { flexDirection: 'row', marginBottom: 12, gap: 6 },
  typeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radiiAlias.button },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input: {
    padding: 10, borderRadius: radiiAlias.input, fontSize: 14,
  },
  fillInput: {},
  submitBtn: { marginTop: 20 },
});
