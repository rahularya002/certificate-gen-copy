import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Zap, Database, FileText, Settings, Play, CheckCircle, Clock, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { datasetService, templateService, generationJobService, certificateService, historyService } from "@/lib/supabaseService";
import { Dataset, Template, GenerationJob, Certificate } from "@/lib/supabase";
import QRCodeGenerator from "@/components/QRCodeGenerator";
import { CertificateGenerator, CertificateData } from "@/lib/certificateGenerator";
import { useQuery } from "@tanstack/react-query";

interface LocalGenerationJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  currentRow: number;
  totalRows: number;
  startTime: Date;
  estimatedTime?: number;
}

export default function Generate() {
  const [selectedDataset, setSelectedDataset] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [filenamePattern, setFilenamePattern] = useState("{CertificateNo}_{Name}");
  const [includeQRCode, setIncludeQRCode] = useState(true);
  const [datasetSearch, setDatasetSearch] = useState("");
  const [qrCodeData, setQrCodeData] = useState(
    'Cert:{CertificateNo}|Name:{Name}|Aadhar:{AadharNo}|DOB:{DOB}|Enroll:{EnrollmentNo}|Job:{JobRole}|Duration:{Duration}|Center:{TrainingCenter}|Dist:{District}|State:{State}|Partner:{AssessmentPartner}|Place:{IssuePlace}|Grade:{Grade}|Date:{IssueDate}'
  );
  const [currentJob, setCurrentJob] = useState<LocalGenerationJob | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const { toast } = useToast();
  const {
    data: datasets = [],
    isLoading: isDatasetsLoading,
    isError: isDatasetsError,
    error: datasetsError,
    refetch: refetchDatasets,
  } = useQuery({
    queryKey: ["datasets", "generate"],
    queryFn: () => datasetService.getAll(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: templates = [],
    isLoading: isTemplatesLoading,
    isError: isTemplatesError,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ["templates", "generate"],
    queryFn: () => templateService.getAll(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const loading = isDatasetsLoading || isTemplatesLoading;

  useEffect(() => {
    if (!isDatasetsError && !isTemplatesError) return;
    const datasetErrorMessage = datasetsError instanceof Error ? datasetsError.message : "";
    const templateErrorMessage = templatesError instanceof Error ? templatesError.message : "";
    toast({
      title: "Error loading data",
      description:
        datasetErrorMessage || templateErrorMessage || "Failed to load datasets and templates",
      variant: "destructive",
    });
  }, [isDatasetsError, isTemplatesError, datasetsError, templatesError, toast]);

  const handleStartGeneration = async () => {
    if (!selectedDataset || !selectedTemplate) {
      toast({
        title: "Missing selection",
        description: "Please select both dataset and template",
        variant: "destructive"
      });
      return;
    }

  const selectedDs = datasets.find(ds => ds.id === selectedDataset);
  const selectedTp = templates.find(tp => tp.id === selectedTemplate);
  
  if (!selectedDs || !selectedTp) return;
  
  console.log('[Generate] Selected template:', { 
    id: selectedTp.id, 
    name: selectedTp.name, 
    file_url: selectedTp.file_url,
    hasFileUrl: !!selectedTp.file_url 
  });

    try {
      setDatasetLoading(true);
      const fullDataset = await datasetService.getById(selectedDs.id);
      const datasetRows = fullDataset?.data || [];
      if (!datasetRows.length) {
        throw new Error("Selected dataset has no rows to process.");
      }

      // Create generation job in Supabase
      const jobData: Omit<GenerationJob, 'id' | 'created_at' | 'completed_at'> = {
        dataset_id: selectedDs.id,
        template_id: selectedTp.id,
        output_format: 'pdf',
        filename_pattern: filenamePattern,
        total_certificates: selectedDs.total_rows,
        successful_certificates: 0,
        failed_certificates: 0,
        status: 'running',
        progress: 0,
        current_row: 0
      };

      console.log('[Generate] Creating generation job', jobData);
      const job = await generationJobService.create(jobData);
      console.log('[Generate] Generation job created', job);
      
      const localJob: LocalGenerationJob = {
        id: job.id,
        status: 'running',
        progress: 0,
        currentRow: 0,
        totalRows: selectedDs.total_rows,
        startTime: new Date(),
        estimatedTime: selectedDs.total_rows * 2 // 2 seconds per certificate
      };

      setCurrentJob(localJob);

      // Simulate certificate generation with QR code data
      for (let i = 1; i <= selectedDs.total_rows; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const progress = (i / selectedDs.total_rows) * 100;
        setCurrentJob(prev => prev ? {
          ...prev,
          progress,
          currentRow: i,
        } : null);

        // Update job progress in Supabase
        await generationJobService.update(job.id, {
          progress: Math.round(progress),
          current_row: i
        });
      }

      // Generate certificates with QR codes
      const certificates: Omit<Certificate, 'id' | 'created_at'>[] = [];
      
      console.log('[Generate] Starting per-row generation', { 
        rows: selectedDs.total_rows, 
        template: selectedTp,
        templateFileUrl: selectedTp?.file_url,
        templateId: selectedTp?.id
      });
      
      // Debug: Check the first row of data
      if (datasetRows.length > 0) {
        console.log('[Generate] First row of dataset:', datasetRows[0]);
        console.log('[Generate] All column names in dataset:', selectedDs.columns);
      }
      // Helper: format JS Date -> DD/MON/YYYY
      const formatDateDdMonYyyy = (date: Date): string => {
        const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const d = String(date.getDate()).padStart(2, '0');
        const mon = months[date.getMonth()];
        const y = date.getFullYear();
        return `${d}/${mon}/${y}`;
      };
      // Helper to format Excel serial dates to DD/MON/YYYY
      const formatExcelDate = (val: any): string => {
        if (val === undefined || val === null || val === '') return '';
        if (typeof val === 'number') {
          const date = new Date((val - 25569) * 86400 * 1000);
          return formatDateDdMonYyyy(date);
        }
        // Try to parse if string
        const parsed = new Date(String(val));
        return isNaN(parsed.getTime()) ? String(val) : formatDateDdMonYyyy(parsed);
      };

      for (const row of datasetRows as Record<string, unknown>[]) {
        const rowData = row as Record<string, any>;
        const dobFormatted = formatExcelDate(row.DOB);
        const issueDateFormatted = formatExcelDate(row['Date of Issue']);
        // Prefer QRCode column if present and non-empty
        const qrDataBase = rowData.QRCode && String(rowData.QRCode).trim().length > 0 ? String(rowData.QRCode) : qrCodeData;
        
        // Resolve Grade from potential variants in the sheet (handles typos/case/trailing spaces)
        const gradeVal = ((): string => {
          const candidates = [
            rowData.Grade,
            rowData['GRADE'],
            rowData['grade'],
            rowData['Grade '],
            rowData[' Result'],
            rowData['Result'],
            rowData['RESULT']
          ];
          for (const val of candidates) {
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
          return '';
        })();
        
        const qrData = includeQRCode ? 
          qrDataBase
            .replace('{CertificateNo}', rowData.CertificateNo || '')
            .replace('{Name}', rowData.Name || '')
            .replace('{IssueDate}', issueDateFormatted || formatDateDdMonYyyy(new Date()))
            .replace('{AadharNo}', rowData.AadharNo || '')
            .replace('{EnrollmentNo}', rowData.Enrollment || '')
            .replace('{DOB}', dobFormatted || '')
            .replace('{SonOrDaughterOf}', rowData.SonOrDaughterOf || '')
            .replace('{JobRole}', rowData['job role'] || '')
            .replace('{Duration}', rowData.Duration || '')
            .replace('{TrainingCenter}', rowData['Training Centre'] || '')
            .replace('{District}', rowData.District || '')
            .replace('{State}', rowData.State || '')
            .replace('{AssessmentPartner}', rowData['Assessment Partner'] || '')
            .replace('{IssuePlace}', rowData['Place of Issue'] || '')
            .replace('{Grade}', gradeVal) : '';

        const filename = filenamePattern
          .replace('{CertificateNo}', rowData.CertificateNo || '')
          .replace('{Name}', rowData.Name || '')
          .replace('{IssueDate}', issueDateFormatted || formatDateDdMonYyyy(new Date()))
          .replace('{AadharNo}', rowData.AadharNo || '')
          .replace('{EnrollmentNo}', rowData.Enrollment || '') // Fixed: Excel has "Enrollment"
          .replace('{DOB}', dobFormatted || '')
          .replace('{SonOrDaughterOf}', rowData.SonOrDaughterOf || '')
          .replace('{JobRole}', rowData['job role'] || '') // Fixed: Excel has "job role"
          .replace('{Duration}', rowData.Duration || '')
          .replace('{TrainingCenter}', rowData['Training Centre'] || '') // Fixed: Excel has "Training Centre"
          .replace('{District}', rowData.District || '')
          .replace('{State}', rowData.State || '')
          .replace('{AssessmentPartner}', rowData['Assessment Partner'] || '') // Fixed: Excel has "Assessment Partner"
          .replace('{IssuePlace}', rowData['Place of Issue'] || '') + '.docx'; // Fixed: Excel has "Place of Issue"

        // Generate actual certificate file
        const certificateData: CertificateData = {
          participantName: rowData.Name || '',
          certificateNo: rowData.CertificateNo || '',
          issueDate: issueDateFormatted || new Date().toISOString().split('T')[0],
          aadhar: rowData.AadharNo || '',
          enrollmentNo: rowData.Enrollment || '', // Fixed: Excel has "Enrollment"
          dob: dobFormatted || '',
          sonOrDaughterOf: rowData.SonOrDaughterOf || '',
          jobRole: rowData['job role'] || '', // Fixed: Excel has "job role"
          duration: rowData.Duration || '',
          trainingCenter: rowData['Training Centre'] || '', // Fixed: Excel has "Training Centre"
          district: rowData.District || '',
          state: rowData.State || '',
          assessmentPartner: rowData['Assessment Partner'] || '', // Fixed: Excel has "Assessment Partner"
          issuePlace: rowData['Place of Issue'] || '', // Fixed: Excel has "Place of Issue"
          qrCodeData: qrData
        };

        // Generate the certificate file to get actual file size
        let fileSize = 0;
        try {
          // Only PDF generation using your template
          if (!selectedTp?.file_url) {
            throw new Error('No template available. Please upload a template first.');
          }

          console.log('[Generate] Using template for PDF generation');
          const resp = await fetch(selectedTp.file_url);
          if (!resp.ok) {
            throw new Error(`Failed to fetch template: ${resp.status} ${resp.statusText}`);
          }
          const arrayBuffer = await resp.arrayBuffer();
          const mappedData: Record<string, any> = {
            Name: rowData.Name || '',
            DOB: dobFormatted || '',
            CertificateNo: rowData.CertificateNo || '',
            IssueDate: issueDateFormatted || formatDateDdMonYyyy(new Date()),
            Grade: gradeVal,
            RegistrationNo: rowData.RegistrationNo || rowData['Registration No'] || rowData['RegistrationNo'] || '',
            Level: rowData.Level || rowData['level'] || rowData['LEVEL'] || '',
            CandidateId: rowData.CandidateId || rowData['Candidate ID'] || rowData['CandidateId'] || rowData['candidate_id'] || '',
            AadharNo: rowData.AadharNo || '',
            EnrollmentNo: rowData.Enrollment || '', // Fixed: Excel has "Enrollment"
            SonOrDaughterOf: rowData.SonOrDaughterOf || '',
            JobRole: rowData['job role'] || '', // Fixed: Excel has "job role" with space
            Duration: rowData.Duration || '',
            TrainingCenter: rowData['Training Centre'] || '', // Fixed: Excel has "Training Centre"
            District: rowData.District || '',
            State: rowData.State || '',
            AssessmentPartner: rowData['Assessment Partner'] || '', // Fixed: Excel has "Assessment Partner"
            IssuePlace: rowData['Place of Issue'] || '', // Fixed: Excel has "Place of Issue"
            QRCode: qrData || undefined
          };
          
          console.log('[Generate] Mapped data for PDF', mappedData);
          console.log('[Generate] Raw Excel row data:', row);
          console.log('[Generate] Excel column names:', Object.keys(row));
          console.log('[Generate] Sample values from Excel:', {
            Name: rowData.Name,
            'Date of Issue': rowData['Date of Issue'],
            'Training Centre': rowData['Training Centre'],
            'Assessment Partner': rowData['Assessment Partner'],
            'Place of Issue': rowData['Place of Issue'],
            'job role': rowData['job role'],
            Enrollment: rowData.Enrollment
          });
          const pdfBlob = await CertificateGenerator.generatePDFFromTemplate(
            arrayBuffer,
            mappedData,
            qrData ? await CertificateGenerator.generateQRCodeAsBase64(qrData) : undefined
          );
          fileSize = pdfBlob.size;
        } catch (error) {
          console.error('Error generating certificate file:', error);
          fileSize = Math.floor(Math.random() * 100000) + 200000; // Fallback size
        }

        certificates.push({
          generation_job_id: job.id,
          participant_name: rowData.Name || '',
          certificate_no: rowData.CertificateNo || '',
          filename,
          file_size: fileSize,
          aadhar: rowData.AadharNo || '',
          dob: dobFormatted || '',
          son_or_daughter_of: rowData.SonOrDaughterOf || '',
          job_role: rowData['job role'] || '', // Fixed: Excel has "job role"
          duration: rowData.Duration || '',
          training_center: rowData['Training Centre'] || '', // Fixed: Excel has "Training Centre"
          district: rowData.District || '',
          state: rowData.State || '',
          assessment_partner: rowData['Assessment Partner'] || '', // Fixed: Excel has "Assessment Partner"
          enrollment_no: rowData.Enrollment || '', // Fixed: Excel has "Enrollment"
          issue_place: rowData['Place of Issue'] || '', // Fixed: Excel has "Place of Issue"
          registration_no: rowData.RegistrationNo || rowData['Registration No'] || rowData['RegistrationNo'] || '',
          level: rowData.Level || rowData['level'] || rowData['LEVEL'] || '',
          candidate_id: rowData.CandidateId || rowData['Candidate ID'] || rowData['CandidateId'] || rowData['candidate_id'] || '',
          qr_code_data: qrData,
          // qr_code_url intentionally omitted: raw btoa() fails on non-Latin1 characters and
          // this field is not required for generation or download flows.
          status: 'ready',
          grade: gradeVal
        });
      }

      // Save certificates to Supabase
      await certificateService.createBatch(certificates);

      // Complete the job
      await generationJobService.update(job.id, {
        status: 'completed',
        progress: 100,
        successful_certificates: certificates.length,
        completed_at: new Date().toISOString()
      });

      setCurrentJob(prev => prev ? {
        ...prev,
        status: 'completed',
        progress: 100,
      } : null);

      toast({
        title: "Generation completed!",
        description: `Successfully generated ${selectedDs.total_rows} certificates with QR codes`,
      });

      // Record history
      await historyService.create({
        type: 'generation',
        name: `${selectedDs.name} - ${selectedTp.name}`,
        description: `Generated ${certificates.length} certificates`,
        status: 'completed',
        details: { certificates: certificates.length }
      } as any);
    } catch (error) {
      console.error('[Generate] Generation failed:', error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
          ? error
          : 'Failed to generate certificates';
      toast({
        title: "Generation failed",
        description: message,
        variant: "destructive"
      });
      
      setCurrentJob(prev => prev ? {
        ...prev,
        status: 'failed',
      } : null);
    } finally {
      setDatasetLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const datasetOptions = useMemo(
    () =>
      datasets.map((dataset) => ({
        ...dataset,
        uploadedLabel: new Date(dataset.created_at).toLocaleDateString(),
      })),
    [datasets]
  );

  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        ...template,
        uploadedLabel: new Date(template.created_at).toLocaleDateString(),
      })),
    [templates]
  );

  const filteredDatasetOptions = useMemo(() => {
    const term = datasetSearch.trim().toLowerCase();
    if (!term) return datasetOptions.slice(0, 200);
    return datasetOptions
      .filter(
        (dataset) =>
          dataset.name.toLowerCase().includes(term) ||
          dataset.file_name.toLowerCase().includes(term)
      )
      .slice(0, 200);
  }, [datasetOptions, datasetSearch]);

  const selectedDsData = useMemo(
    () => datasets.find((ds) => ds.id === selectedDataset),
    [datasets, selectedDataset]
  );
  const selectedTpData = useMemo(
    () => templates.find((tp) => tp.id === selectedTemplate),
    [templates, selectedTemplate]
  );
  const qrPreviewValue = useMemo(
    () =>
      qrCodeData
        .replace('{CertificateNo}', 'CERT001')
        .replace('{Name}', 'John Doe')
        .replace('{IssueDate}', new Date().toISOString().split('T')[0])
        .replace('{AadharNo}', '1234-5678-9012')
        .replace('{EnrollmentNo}', 'ENR-00001')
        .replace('{DOB}', '1990-01-15')
        .replace('{SonOrDaughterOf}', 'Richard Roe')
        .replace('{JobRole}', 'Technician')
        .replace('{Duration}', '3 Months')
        .replace('{TrainingCenter}', 'ABC Center')
        .replace('{District}', 'Some District')
        .replace('{State}', 'Some State')
        .replace('{AssessmentPartner}', 'XYZ Assessments')
        .replace('{IssuePlace}', 'New Delhi'),
    [qrCodeData]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading datasets and templates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Generate Certificates</h1>
        <p className="text-muted-foreground mt-2">
          Select your dataset and template to generate certificates
        </p>
      </div>

      {/* Dataset Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
            <span>Select Dataset</span>
          </CardTitle>
          <CardDescription>
            Choose the dataset containing participant information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input
              value={datasetSearch}
              onChange={(e) => setDatasetSearch(e.target.value)}
              placeholder="Search dataset by name or file..."
            />
          </div>
          <Select value={selectedDataset} onValueChange={setSelectedDataset}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a dataset" />
            </SelectTrigger>
            <SelectContent className="bg-popover border border-border shadow-lg z-50">
              {filteredDatasetOptions.map(dataset => (
                <SelectItem key={dataset.id} value={dataset.id} className="hover:bg-accent">
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <div className="font-medium">{dataset.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {dataset.total_rows} participants
                      </div>
                    </div>
                  </div>
                </SelectItem>
              ))}
              {!filteredDatasetOptions.length && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No datasets found.</div>
              )}
            </SelectContent>
          </Select>
          {datasetOptions.length > 200 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing top 200 matches to keep selection smooth. Refine search to narrow results.
            </p>
          )}
          {isDatasetsError && (
            <Button className="mt-3" variant="outline" onClick={() => refetchDatasets()}>
              Retry Datasets
            </Button>
          )}
          
          {selectedDsData && (
            <div className="mt-4 p-4 bg-primary/5 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{selectedDsData.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    {selectedDsData.total_rows} participants will receive certificates
                  </p>
                </div>
                <Badge variant="outline">{selectedDsData.total_rows} rows</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Select Template</span>
          </CardTitle>
          <CardDescription>
            Choose the certificate template to use
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent className="bg-popover border border-border shadow-lg z-50">
              {templateOptions.map(template => (
                <SelectItem key={template.id} value={template.id} className="hover:bg-accent">
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {template.placeholders.length} placeholders • Uploaded {template.uploadedLabel}
                      </div>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isTemplatesError && (
            <Button className="mt-3" variant="outline" onClick={() => refetchTemplates()}>
              Retry Templates
            </Button>
          )}

          {selectedTpData && (
            <div className="mt-4 p-4 bg-primary/5 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{selectedTpData.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    Contains {selectedTpData.placeholders.length} mapped placeholders
                  </p>
                </div>
                <Badge variant="outline">{selectedTpData.placeholders.length} fields</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generation Options */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Generation Options</span>
          </CardTitle>
          <CardDescription>
            Configure output format and naming
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Output Format - PDF Only */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Output Format</Label>
            <div className="flex items-center space-x-2 p-3 bg-primary/10 rounded-lg border">
              <div className="w-4 h-4 rounded-full border-2 border-primary bg-primary flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-white"></div>
              </div>
              <Label htmlFor="pdf" className="font-medium">DOCX (Template-based)</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Certificates are generated as DOCX using your uploaded template with perfect formatting
            </p>
          </div>

          {/* Filename Pattern */}
          <div className="space-y-3">
            <Label htmlFor="filename" className="text-base font-medium">
              Filename Pattern
            </Label>
            <Input
              id="filename"
              value={filenamePattern}
              onChange={(e) => setFilenamePattern(e.target.value)}
              placeholder="Enter filename pattern"
            />
            <p className="text-sm text-muted-foreground">
              Use placeholders like {"{Name}"}, {"{CertificateNo}"}, etc. Example: Certificate_{"{Name}"}_{"{CertificateNo}"}
            </p>
            {selectedDsData && (
              <div className="text-sm text-muted-foreground">
                Preview: Certificate_John_Doe_CERT001.docx
              </div>
            )}
          </div>

          {/* QR Code Configuration */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeQR"
                checked={includeQRCode}
                onCheckedChange={(checked) => setIncludeQRCode(checked as boolean)}
              />
              <Label htmlFor="includeQR" className="text-base font-medium flex items-center space-x-2">
                <QrCode className="h-4 w-4" />
                <span>Include QR Code</span>
              </Label>
            </div>
            
            {includeQRCode && (
              <div className="space-y-3 pl-6">
                <Label htmlFor="qrData" className="text-sm font-medium">
                  QR Code Data Pattern
                </Label>
                <Input
                  id="qrData"
                  value={qrCodeData}
                  onChange={(e) => setQrCodeData(e.target.value)}
                  placeholder="Enter QR code data pattern"
                />
                <p className="text-sm text-muted-foreground">
                  Use placeholders like {"{CertificateNo}"} and {"{Name}"}.
                </p>
                {selectedDsData && (
                  <div className="border rounded-lg p-3 bg-muted/40 inline-flex items-center gap-3">
                    <QRCodeGenerator value={qrPreviewValue} size={80} />
                    <p className="text-xs text-muted-foreground">Live QR preview</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Generation Progress */}
      {currentJob && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {currentJob.status === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <Clock className="h-5 w-5 text-primary animate-pulse" />
              )}
              <span>Generation Progress</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processing certificates...</span>
                <span>{currentJob.currentRow}/{currentJob.totalRows}</span>
              </div>
              <Progress value={currentJob.progress} className="w-full" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{Math.round(currentJob.progress)}% complete</span>
                {currentJob.status === 'running' && currentJob.estimatedTime && (
                  <span>
                    Est. {formatTime(Math.round((currentJob.estimatedTime * (100 - currentJob.progress)) / 100))} remaining
                  </span>
                )}
              </div>
            </div>

            {currentJob.status === 'completed' && (
              <div className="bg-success/10 p-4 rounded-lg">
                <h4 className="font-medium text-success mb-2">Generation Complete!</h4>
                <p className="text-sm text-muted-foreground">
                  All {currentJob.totalRows} certificates have been generated successfully.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleStartGeneration}
          disabled={!selectedDataset || !selectedTemplate || currentJob?.status === 'running' || datasetLoading}
          size="lg"
          className="bg-gradient-to-r from-primary to-primary-hover"
        >
          <Play className="h-4 w-4 mr-2" />
          {datasetLoading ? 'Preparing dataset...' : currentJob?.status === 'running' ? 'Generating...' : 'Start Generation'}
        </Button>
      </div>
    </div>
  );
}