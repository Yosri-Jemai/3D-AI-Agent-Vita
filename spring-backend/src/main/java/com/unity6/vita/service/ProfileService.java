package com.unity6.vita.service;

import com.unity6.vita.dto.AuthDTO;
import com.unity6.vita.dto.ProfileDTO;
import com.unity6.vita.entity.ConversationExtraction;
import com.unity6.vita.entity.Profile;
import com.unity6.vita.entity.Role;
import com.unity6.vita.entity.InteractionSession;
import com.unity6.vita.repository.ConversationExtractionRepository;
import com.unity6.vita.repository.EvaluationRepository;
import com.unity6.vita.repository.ProfileRepository;
import com.unity6.vita.repository.TrainingSessionRepository;
import com.unity6.vita.util.JwtUtil;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.HashMap;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProfileService {

    private final ProfileRepository profileRepository;
    private final EmailService emailService;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtUtil jwtUtil;
    private final TrainingSessionRepository trainingSessionRepository;
    private final EvaluationRepository evaluationRepository;
    private final ConversationExtractionRepository conversationExtractionRepository;
    private final ObjectMapper objectMapper;

    public Profile toEntity(ProfileDTO profileDTO) {
        return Profile.builder()
                .id(profileDTO.getId())
                .fullName(profileDTO.getFullName())
                .email(profileDTO.getEmail())
                .password(passwordEncoder.encode(profileDTO.getPassword()))
                .profileImageUrl(profileDTO.getProfileImageUrl())
                .numTelephone(profileDTO.getNumTelephone())
                .role(profileDTO.getRole())
                .createdAt(profileDTO.getCreatedAt())
                .build();
    }

    public ProfileDTO toDTO(Profile profile) {
        return ProfileDTO.builder()
                .id(profile.getId())
                .fullName(profile.getFullName())
                .email(profile.getEmail())
                .password(profile.getPassword())
                .numTelephone(profile.getNumTelephone())
                .profileImageUrl(profile.getProfileImageUrl())
                .role(profile.getRole())
                .createdAt(profile.getCreatedAt())
                .build();
    }

    public ProfileDTO registerProfile(ProfileDTO profileDTO) {
        Profile newProfile = toEntity(profileDTO);
        String activationToken = UUID.randomUUID().toString();
        newProfile.setActivationToken(activationToken);
        newProfile.setIsActive(false); // Explicitly set to false

        Profile savedProfile = profileRepository.save(newProfile);
        System.out.println("✅ Profile registered: " + savedProfile.getEmail());
        System.out.println("🔑 Activation token: " + activationToken);

        // Correct activation link with /api/v1
        String activationLink = "http://localhost:8080/api/v1/activate?token=" + activationToken;
        String subject = "Activez votre compte VitalAgent";
        String body = "Bonjour " + savedProfile.getFullName() + ",\n\n" +
                "Cliquez sur le lien suivant pour activer votre compte VitalAgent :\n\n" +
                activationLink + "\n\n" +
                "Ce lien expire dans 24 heures.\n\n" +
                "Cordialement,\n" +
                "L'équipe VitalAgent";

        try {
            emailService.sendEmail(savedProfile.getEmail(), subject, body);
            System.out.println("📧 Activation email sent to: " + savedProfile.getEmail());
        } catch (Exception e) {
            System.err.println("❌ Failed to send email: " + e.getMessage());
        }

        return toDTO(savedProfile);
    }

    public ProfileDTO registerAdminProfile(ProfileDTO profileDTO) {
        if (profileDTO.getEmail() == null || profileDTO.getEmail().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email is required");
        }
        if (profileDTO.getPassword() == null || profileDTO.getPassword().length() < 6) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password must contain at least 6 characters");
        }
        if (profileRepository.findByEmail(profileDTO.getEmail().trim()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already exists");
        }

        Profile newProfile = toEntity(profileDTO);
        newProfile.setRole(Role.ADMIN);
        newProfile.setIsActive(true);
        newProfile.setActivationToken(null);

        Profile savedProfile = profileRepository.save(newProfile);
        return toDTO(savedProfile);
    }

    public boolean activateAccount(String activationToken) {
        System.out.println("🔑 Activating account with token: " + activationToken);

        return profileRepository.findByActivationToken(activationToken)
                .map(profile -> {
                    System.out.println("📧 Found profile: " + profile.getEmail());
                    System.out.println("Current isActive: " + profile.getIsActive());

                    profile.setIsActive(true);
                    profile.setActivationToken(null); // Clear the token after activation
                    Profile saved = profileRepository.save(profile);

                    System.out.println("✅ After save - isActive: " + saved.getIsActive());
                    return true;
                }).orElse(false);
    }

    public boolean isAccountActive(String email) {
        return profileRepository.findByEmail(email)
                .map(profile -> {
                    Boolean isActive = profile.getIsActive();
                    System.out.println("Checking account: " + email + " - isActive: " + isActive);
                    return isActive != null && isActive;
                })
                .orElse(false);
    }

    public Profile getCurrentProfile() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return profileRepository.findByEmail(authentication.getName())
                .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + authentication.getName()));
    }

    public ProfileDTO getPublicProfile(String email) {
        if(email == null) {
            return toDTO(getCurrentProfile());
        } else {
            return toDTO(profileRepository.findByEmail(email)
                    .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + email)));
        }
    }

    public Map<String, Object> authenticateAndGenerateToken(AuthDTO authDTO) {
        try {
            System.out.println("🔐 Authenticating user: " + authDTO.getEmail());

            authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(authDTO.getEmail(), authDTO.getPassword())
            );

            String token = jwtUtil.generateToken(authDTO.getEmail());
            System.out.println("🎫 Token generated for: " + authDTO.getEmail());

            return Map.of(
                    "token", token,
                    "user", getPublicProfile(authDTO.getEmail())
            );
        } catch (Exception e) {
            System.err.println("❌ Authentication failed: " + e.getMessage());
            throw new UsernameNotFoundException("Invalid email or password");
        }
    }

    public List<ProfileDTO> getAllProfiles() {
        List<Profile> profiles = profileRepository.findAll();
        return profiles.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    public void ensureAdminAccess(String email) {
        Profile profile = profileRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + email));
        if (profile.getRole() != Role.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin access only");
        }
    }

    public Map<String, Object> getAdminDashboardStats() {
        long totalUsers = profileRepository.count();
        long totalDelegates = profileRepository.countByRole(Role.DELEGATE);
        long totalProfessionals = profileRepository.countByRole(Role.PROFESSIONAL);
        long totalAdmins = profileRepository.countByRole(Role.ADMIN);
        long totalMedicalSessions = trainingSessionRepository.countByMode("medical");
        long totalCommercialSessions = trainingSessionRepository.countByMode("commercial");
        long successfulEvaluations = evaluationRepository.countByScoreGreaterThanEqual(70f);
        long totalEvaluations = evaluationRepository.count();
        double completionRate = totalEvaluations == 0 ? 0d : (successfulEvaluations * 100.0) / totalEvaluations;

        List<Map<String, Object>> latestSessions = trainingSessionRepository.findTop10ByOrderByStartedAtDesc()
                .stream()
                .map(session -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("sessionUuid", session.getSessionUuid());
                    row.put("profileId", session.getProfileId());
                    row.put("mode", session.getMode());
                    row.put("startedAt", session.getStartedAt());
                    row.put("endedAt", session.getEndedAt());
                    return row;
                })
                .collect(Collectors.toList());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("totalUsers", totalUsers);
        response.put("totalDelegates", totalDelegates);
        response.put("totalProfessionals", totalProfessionals);
        response.put("totalAdmins", totalAdmins);
        response.put("totalMedicalSessions", totalMedicalSessions);
        response.put("totalCommercialSessions", totalCommercialSessions);
        response.put("totalEvaluations", totalEvaluations);
        response.put("successfulEvaluations", successfulEvaluations);
        response.put("completionRate", Math.round(completionRate * 100.0) / 100.0);
        response.put("latestSessions", latestSessions);
        return response;
    }

    public Map<String, Object> getCommercialTrackingStats() {
        List<ConversationExtraction> extractions = conversationExtractionRepository.findTop20ByOrderByExtractedAtDesc();
        int extractionCount = extractions.size();
        double averageEngagement = extractions.stream()
                .filter(e -> e.getEngagementScore() != null)
                .mapToInt(ConversationExtraction::getEngagementScore)
                .average()
                .orElse(0.0);

        Map<String, Integer> productFrequency = new HashMap<>();
        for (ConversationExtraction extraction : extractions) {
            try {
                List<String> products = objectMapper.readValue(extraction.getProducts(), new TypeReference<List<String>>() {});
                for (String product : products) {
                    if (product != null && !product.isBlank()) {
                        productFrequency.merge(product.trim(), 1, Integer::sum);
                    }
                }
            } catch (Exception ignored) {
            }
        }

        List<Map<String, Object>> topProducts = productFrequency.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(8)
                .map(entry -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("product", entry.getKey());
                    row.put("mentions", entry.getValue());
                    return row;
                })
                .collect(Collectors.toList());

        long delegatesInCommercialMode = trainingSessionRepository.findTop10ByOrderByStartedAtDesc().stream()
                .filter(session -> "commercial".equalsIgnoreCase(session.getMode()))
                .map(InteractionSession::getProfileId)
                .distinct()
                .count();

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("recentExtractions", extractionCount);
        response.put("averageEngagementScore", Math.round(averageEngagement * 100.0) / 100.0);
        response.put("delegatesActiveInCommercialMode", delegatesInCommercialMode);
        response.put("topProducts", topProducts);
        return response;
    }

    public Profile getProfileById(Long id) {
        return profileRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Profile not found with id: " + id));
    }
}